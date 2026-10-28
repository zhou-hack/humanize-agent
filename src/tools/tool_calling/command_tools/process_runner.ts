import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProcessResult, ProcessSpec } from './types.js'

const DEFAULT_MAX_OUTPUT_BYTES = 1024
const TERMINATE_GRACE_MS = 1000

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  const temporaryHome = await mkdtemp(path.join(tmpdir(), 'humanize-agent-command-'))

  try {
    await Promise.all([
      writeFile(path.join(temporaryHome, 'npm-userrc'), ''),
      writeFile(path.join(temporaryHome, 'npm-globalrc'), '')
    ])
    return await execute(spec, temporaryHome)
  } finally {
    await rm(temporaryHome, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function execute(spec: ProcessSpec, temporaryHome: string): Promise<ProcessResult> {
  const child = spawn(spec.executable, [...spec.args], {
    cwd: spec.cwd,
    env: createEnvironment(spec.env, temporaryHome),
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdout = new BoundedOutput(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)
  const stderr = new BoundedOutput(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)

  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

  let timedOut = false
  let termination: Promise<void> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    termination = terminateProcessTree(child, spec.env.SystemRoot)
    termination.catch(() => undefined)
  }, spec.timeoutMs)

  try {
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal }))
      }
    )

    if (termination) {
      await termination
    }

    return {
      exitCode: outcome.code,
      signal: outcome.signal,
      timedOut,
      truncated: stdout.truncated || stderr.truncated,
      stdout: stdout.value(),
      stderr: stderr.value()
    }
  } finally {
    clearTimeout(timer)
  }
}

function createEnvironment(
  base: NodeJS.ProcessEnv,
  temporaryHome: string
): NodeJS.ProcessEnv {
  return {
    ...base,
    HOME: temporaryHome,
    USERPROFILE: temporaryHome,
    XDG_CONFIG_HOME: path.join(temporaryHome, 'config'),
    XDG_CACHE_HOME: path.join(temporaryHome, 'cache'),
    TEMP: temporaryHome,
    TMP: temporaryHome,
    TMPDIR: temporaryHome,
    npm_config_cache: path.join(temporaryHome, 'npm-cache'),
    npm_config_userconfig: path.join(temporaryHome, 'npm-userrc'),
    npm_config_globalconfig: path.join(temporaryHome, 'npm-globalrc')
  }
}

async function terminateProcessTree(
  child: ChildProcess,
  systemRoot: string | undefined
): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    const root = systemRoot ?? process.env.SystemRoot
    if (!root) {
      throw new Error('缺少 SystemRoot，无法终止进程树')
    }
    const taskkill = path.join(root, 'System32', 'taskkill.exe')
    await runTaskkill(taskkill, child.pid)
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (!isNodeError(error, 'ESRCH')) {
      throw error
    }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, TERMINATE_GRACE_MS))

  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (!isNodeError(error, 'ESRCH')) {
        throw error
      }
    }
  }
}

function runTaskkill(executable: string, pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const killer = spawn(executable, ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.once('error', reject)
    killer.once('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('终止进程树失败'))
      }
    })
  })
}

class BoundedOutput {
  private readonly chunks: Buffer[] = []
  private length = 0
  truncated = false

  constructor(private readonly maximumBytes: number) {}

  push(chunk: Buffer): void {
    const remaining = this.maximumBytes - this.length

    if (remaining > 0) {
      const retained = chunk.subarray(0, remaining)
      this.chunks.push(retained)
      this.length += retained.length
    }

    if (chunk.length > remaining) {
      this.truncated = true
    }
  }

  value(): string {
    return Buffer.concat(this.chunks, this.length).toString('utf8')
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as NodeJS.ErrnoException).code === code
}
