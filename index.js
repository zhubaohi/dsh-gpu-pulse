/**
 * dsh-gpu-pulse — host half (adds per-GPU names + driver version via
 * parallel nvidia-smi queries).
 */
import { execFile } from 'node:child_process'

export const name = 'dsh-gpu-pulse'

const STATUS_PATH = '/dsh-gpu-pulse/status'
const SMI_TIMEOUT_MS = 4000
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
  const m = /driver version:\s*([^\r\n]+)/i.exec(text)
  return m ? m[1].trim() : null
}

export function apply(ctx, config) {
  const smiPath = (config && config.nvidiaSmiPath) || 'nvidia-smi'

  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const disposeRoute = hostCtx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          try {
            const [metricsRes, namesRes, versionRes] = await Promise.allSettled([
              runSmi(smiPath, [
                '--query-gpu',
                'index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
                '--format=csv,noheader,nounits'
              ]),
              runSmi(smiPath, ['--query-gpu', 'index,name', '--format=csv,noheader,nounits']),
              runSmi(smiPath, ['--version'])
            ])
            if (metricsRes.status !== 'fulfilled') throw metricsRes.reason
            const names = namesRes.status === 'fulfilled' ? parseNameLines(namesRes.value) : new Map()
            const driverVersion = versionRes.status === 'fulfilled' ? parseDriverVersion(versionRes.value) : null
            const gpus = parseMetricsLines(metricsRes.value).map(m => ({ ...m, name: names.get(m.index) ?? `GPU ${m.index ?? 0}` }))
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store'
            })
            response.end(JSON.stringify({ ok: true, backend: 'nvidia-smi', driverVersion, gpus, ts: Date.now() }))
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