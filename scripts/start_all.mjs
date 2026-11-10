import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const services = [
  { name: 'Web UI', entry: 'dist/ui/server/index.js' },
  { name: 'QQ', entry: 'dist/channel/onebot/index.js' },
  { name: '微信 iLink Bot', entry: 'dist/channel/ilinkbot/index.js' }
]
const children = new Map()
let stopping = false
let exitCode = 0

function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  exitCode = code
  for (const child of children.values()) child.kill()
}

for (const service of services) {
  const child = spawn(process.execPath, [service.entry], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  children.set(service.name, child)
  process.stdout.write(`[all] 已启动 ${service.name}（PID ${child.pid}）\n`)

  child.once('error', error => {
    process.stderr.write(`[all] ${service.name} 启动失败：${error.message}\n`)
    stopAll(1)
  })
  child.once('exit', (code, signal) => {
    children.delete(service.name)
    if (!stopping) {
      process.stderr.write(`[all] ${service.name} 已退出，正在停止其他服务。\n`)
      stopAll(code ?? (signal ? 1 : 0))
    }
    if (children.size === 0) process.exitCode = exitCode
  })
}

process.once('SIGINT', () => stopAll(0))
process.once('SIGTERM', () => stopAll(0))
