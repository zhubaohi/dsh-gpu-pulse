/**
 * dsh-gpu-pulse — host half (adds result cache + driver-missing re-probe).
 */
import { execFile } from 'node:child_process'

export const name = 'dsh-gpu-pulse'

const STATUS_PATH = '/dsh-gpu-pulse/status'
const CACHE_TTL_MS = 1200
const SMI_TIMEOUT_MS = 4000
const REPROBE_MS = 5 * 60 * 1000
const NA = '[N/A]'

function toNum(value) {
  if (value === undefined || value === NA) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

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

function isMissingBinary(error) {
  if (error?.code === 'ENOENT') return true
  return /is not recognized|cannot find|no such file/i.test(String(error?.message ?? ''))
}

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

function parseDriverVersion(text) {
  const kmd = /kmd version\s*:\s*([^\r\n]+)/i.exec(text)
  if (kmd) return kmd[1].trim()
  const drv = /driver version\s*:\s*([^\r\n]+)/i.exec(text)
  if (drv && !/^deprecated/i.test(drv[1])) return drv[1].trim()
  return null
}

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

    const [metricsRes, namesRes, versionRes] = await Promise.allSettled([
      runSmi(cfg.nvidiaSmiPath, [
        '--query-gpu',
        'index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
        '--format=csv,noheader,nounits'
      ]),
      runSmi(cfg.nvidiaSmiPath, ['--query-gpu', 'index,name', '--format=csv,noheader,nounits']),
      runSmi(cfg.nvidiaSmiPath, ['--version'])
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
    const names = namesRes.status === 'fulfilled' ? parseNameLines(namesRes.value) : new Map()
    const driverVersion = versionRes.status === 'fulfilled' ? parseDriverVersion(versionRes.value) : null
    const gpus = parseMetricsLines(metricsRes.value).map(m => ({ ...m, name: names.get(m.index) ?? `GPU ${m.index ?? 0}` }))

    cache = { ts: now, payload: { ok: true, backend: 'nvidia-smi', driverVersion, gpus, ts: now } }
    return cache.payload
  }
}

function resolveConfig(config) {
  const cfg = { pollMs: 2000, showProcesses: false, nvidiaSmiPath: 'nvidia-smi', ...(config ?? {}) }
  if (!Number.isFinite(cfg.pollMs) || cfg.pollMs < 500) cfg.pollMs = 2000
  if (typeof cfg.nvidiaSmiPath !== 'string' || cfg.nvidiaSmiPath === '') cfg.nvidiaSmiPath = 'nvidia-smi'
  cfg.showProcesses = cfg.showProcesses === true
  return cfg
}

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