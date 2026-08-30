/**
 * Standalone smoke test for the dsh-gpu-pulse host half: applies the plugin
 * against a mock cordis context, then invokes the registered route handler
 * with a fake request/response and prints the JSON payload.
 */
import { apply } from '../index.js'

const registered = []
const ctx = {
  inject(services, cb) {
    if (!services.includes('webServer')) throw new Error('expected webServer inject: ' + services)
    const webServer = {
      register(def) {
        registered.push(def)
        return () => { registered.pop() }
      }
    }
    const hostCtx = {
      webServer,
      effect(fn, label) {
        console.log(`[effect] ${label}`)
        const disposer = fn()
        return disposer
      }
    }
    cb(hostCtx)
  }
}

apply(ctx, { showProcesses: true })

if (registered.length !== 1) throw new Error(`expected 1 route, got ${registered.length}`)
const route = registered[0]
console.log(`[route] kind=${route.kind} path=${route.path}`)
if (route.kind !== 'exact' || route.path !== '/dsh-gpu-pulse/status') throw new Error('unexpected route shape')

// 405 branch
{
  const res = { code: 0, body: '' }
  res.writeHead = (code) => { res.code = code }
  res.end = (b) => { res.body += b }
  await route.handler({ method: 'POST' }, res)
  console.log(`[405 branch] status=${res.code}`)
}

// 200 branch (real nvidia-smi on this machine)
{
  const res = { code: 0, body: '' }
  res.writeHead = (code) => { res.code = code }
  res.end = (b) => { res.body += b }
  await route.handler({ method: 'GET' }, res)
  console.log(`[200 branch] status=${res.code}`)
  const payload = JSON.parse(res.body)
  console.log(JSON.stringify(payload, null, 2))
  if (!payload.ok) throw new Error('expected ok=true on this machine')
  if (!Array.isArray(payload.gpus) || payload.gpus.length < 2) throw new Error('expected 2 GPUs')
  for (const g of payload.gpus) {
    if (typeof g.name !== 'string' || g.name === '') throw new Error('missing gpu name')
    console.log(`- GPU${g.index} ${g.name}: util=${g.util}% vram=${g.memUsedMiB}/${g.memTotalMiB}MiB temp=${g.temp}C pwr=${g.powerW}W fan=${g.fanPct}%`)
  }
  console.log(`driver=${payload.driverVersion} processes=${payload.processes ? payload.processes.length : 0}`)
}

console.log('SMOKE OK')