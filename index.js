/**
 * dsh-gpu-pulse — host half of the in-GUI GPU monitor.
 *
 * Serves live NVIDIA GPU telemetry from nvidia-smi over one exact route:
 *
 *   GET /dsh-gpu-pulse/status
 *     { ok: true, backend: "nvidia-smi", driverVersion: "616.56",
 *       gpus: [{ index, name, util, memUsedMiB, memTotalMiB, temp,
 *               powerW, fanPct }],
 *       processes?: [{ pid, name, usedMiB }],
 *       config: { pollMs, showProcesses }, ts }
 *     { ok: false, backend: "nvidia-smi", reason: "...", ts }
 *
 * The client widget (client/client.js) polls that route. nvidia-smi is
 * spawned with a 4 s timeout, and results are cached for ~1.2 s so several
 * open tabs polling in parallel share one process. Numeric fields that
 * nvidia-smi reports as [N/A] (fan on laptop GPUs, idle power on some
 * drivers) arrive as `null` and the widget renders a dash.
 *
 * Optional entry config (a `config:` block on the plugin row, e.g. in the
 * profile's cordis.patch.yml — an id-targeted patch replaces the whole
 * config, so restate every field you want to keep):
 *   pollMs         client poll interval hint in ms (default 2000, floor 500)
 *   showProcesses  include per-process VRAM consumers (default false)
 *   nvidiaSmiPath  explicit binary path (default "nvidia-smi", via PATH)
 *
 * Machines without an NVIDIA driver (or before a driver is installed) get
 * `{ ok: false, reason }`; the plugin re-probes every 5 minutes so the
 * widget lights up on its own once a driver appears.
 */
import { execFile } from 'node:child_process'

export const name = 'dsh-gpu-pulse'

const STATUS_PATH = '/dsh-gpu-pulse/status'
const CACHE_TTL_MS = 1200
const SMI_TIMEOUT_MS = 4000
const REPROBE_MS = 5 * 60 * 1000
const NA = '[N/A]'

const DEFAULTS = Object.freeze({
  pollMs: 2000,
  showProcesses: false,
  nvidiaSmiPath: 'nvidia-smi'
})

/** Numeric field that nvidia-smi may report as `[N/A]` → number or null. */
function toNum(value) {
  if (value === undefined || value === NA) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Run nvidia-smi with args; resolve(stdout) or reject(error). */
function runSmi(smiPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      smiPath,
      args,
      { timeout: SMI_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error === null ? resolve(String(stdout)) : reject(error))
    )
  })
}

/** True when the spawn failed because the binary itself is absent. */
function isMissingBinary(error) {
  if (error?.code === 'ENOENT') return true
  return /is not recognized|cannot find|no such file/i.test(String(error?.message ?? ''))
}

/** `--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed` — fixed field order, no commas in any value. */
function parseMetricsLines(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const c = line.split(',').map(s => s.trim())
    if (c.length < 7) continue
    out.push({
      index: toNum(c[0]),
      util: toNum(c[1]),
      memUsedMiB: toNum(c[2]),
      memTotalMiB: toNum(c[3]),
      temp: toNum(c[4]),
      powerW: toNum(c[5]),
      fanPct: toNum(c[6])
    })
  }
  return out
}

/** `--query-gpu=index,name` — the name may contain commas: first cell is the index, the rest is the name. */
function parseNameLines(text) {
  const names = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const first = line.indexOf(',')
    if (first === -1) continue
    const idx = toNum(line.slice(0, first).trim())
    if (idx === null) continue
    names.set(idx, line.slice(first + 1).trim())
  }
  return names
}

/** `--query-compute-apps=pid,process_name,used_memory` — the process name may contain commas: first cell pid, last cell MiB. Names are reduced to the basename for display; entries whose used_memory is [N/A] (most graphics contexts on recent Windows drivers) are dropped so the widget only lists real VRAM consumers. */
function parseProcessLines(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const first = line.indexOf(',')
    const last = line.lastIndexOf(',')
    if (first === -1 || last === first) continue
    const pid = toNum(line.slice(0, first).trim())
    if (pid === null) continue
    const usedMiB = toNum(line.slice(last + 1).trim())
    if (usedMiB === null) continue
    const full = line.slice(first + 1, last).trim()
    const base = full.replace(/\\/g, '/').split('/').pop()
    out.push({ pid, name: base && base.length > 0 ? base : full, usedMiB })
  }
  return out
}

/** Version line of `nvidia-smi --version`: 616.x+ reports `KMD version` and marks `Driver version` deprecated; older drivers report `Driver Version: X`. Prefer KMD when present. */
function parseDriverVersion(text) {
  const kmd = /kmd version\s*:\s*([^\r\n]+)/i.exec(text)
  if (kmd) return kmd[1].trim()
  const drv = /driver version\s*:\s*([^\r\n]+)/i.exec(text)
  if (drv && !/^deprecated/i.test(drv[1])) return drv[1].trim()
  return null
}

/**
 * Build the request-time status payload with a short-lived cache: a fresh
 * hit reuses the last payload, a stale hit re-collects, and a known-missing
 * binary is re-probed only every REPROBE_MS.
 */
function createCollector(cfg) {
  let cache = null
  let lastProbe = 0
  let knownMissing = null

  return async function collect() {
    const now = Date.now()
    if (cache !== null && now - cache.ts < CACHE_TTL_MS) return cache.payload

    if (knownMissing !== null && now - lastProbe < REPROBE_MS) {
      return { ok: false, backend: 'nvidia-smi', reason: knownMissing, ts: now }
    }
    lastProbe = now

    const [metricsRes, namesRes, versionRes, procsRes] = await Promise.allSettled([
      runSmi(cfg.nvidiaSmiPath, [
        '--query-gpu',
        'index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
        '--format=csv,noheader,nounits'
      ]),
      runSmi(cfg.nvidiaSmiPath, ['--query-gpu', 'index,name', '--format=csv,noheader,nounits']),
      runSmi(cfg.nvidiaSmiPath, ['--version']),
      cfg.showProcesses
        ? runSmi(cfg.nvidiaSmiPath, ['--query-compute-apps', 'pid,process_name,used_memory', '--format=csv,noheader,nounits'])
        : Promise.resolve('')
    ])

    if (metricsRes.status !== 'fulfilled') {
      const err = metricsRes.reason
      knownMissing = isMissingBinary(err)
        ? `nvidia-smi not found — is the NVIDIA driver installed? (tried "${cfg.nvidiaSmiPath}")`
        : `nvidia-smi failed: ${String(err?.message ?? err)}`
      cache = { ts: now, payload: { ok: false, backend: 'nvidia-smi', reason: knownMissing, ts: now } }
      return cache.payload
    }

    knownMissing = null
    const metrics = parseMetricsLines(metricsRes.value)
    const names = namesRes.status === 'fulfilled' ? parseNameLines(namesRes.value) : new Map()
    const driverVersion = versionRes.status === 'fulfilled' ? parseDriverVersion(versionRes.value) : null

    const gpus = metrics.map(m => ({ ...m, name: names.get(m.index) ?? `GPU ${m.index ?? 0}` }))
    let processes = procsRes.status === 'fulfilled' ? parseProcessLines(procsRes.value) : null
    if (processes !== null) {
      processes.sort((a, b) => b.usedMiB - a.usedMiB)
      if (processes.length > 12) processes.length = 12
      // Drivers that do not attribute VRAM per process (most Windows 616.x)
      // yield an empty list after the [N/A] filter — omit the section rather
      // than show an empty one.
      if (processes.length === 0) processes = null
    }

    const payload = {
      ok: true,
      backend: 'nvidia-smi',
      driverVersion,
      gpus,
      ...(processes !== null ? { processes } : {}),
      config: { pollMs: cfg.pollMs, showProcesses: cfg.showProcesses },
      ts: now
    }
    cache = { ts: now, payload }
    return payload
  }
}

/** Validate + default the entry config (everything optional). */
function resolveConfig(config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  if (!Number.isFinite(cfg.pollMs) || cfg.pollMs < 500) cfg.pollMs = DEFAULTS.pollMs
  if (typeof cfg.nvidiaSmiPath !== 'string' || cfg.nvidiaSmiPath === '') cfg.nvidiaSmiPath = DEFAULTS.nvidiaSmiPath
  cfg.showProcesses = cfg.showProcesses === true
  return cfg
}

/**
 * Register the status route on the host web server.
 * @param ctx - host context (injects `webServer` lazily so the plugin boots on web AND headless profiles).
 * @param config - optional entry config, see module docs.
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  const collect = createCollector(cfg)

  ctx.inject(['webServer'], (hostCtx) => {
    const host = hostCtx
    host.effect(() => {
      const disposeRoute = host.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          try {
            const payload = await collect()
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store'
            })
            response.end(JSON.stringify(payload))
          } catch (err) {
            response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify({
              ok: false,
              backend: 'nvidia-smi',
              reason: String(err?.message ?? err),
              ts: Date.now()
            }))
          }
        }
      })
      return () => {
        if (typeof disposeRoute === 'function') disposeRoute()
      }
    }, 'dsh-gpu-pulse: status route')
  })
}