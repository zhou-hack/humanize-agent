import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'

export async function resolveCommandEnvironment(
  workspaceRoot: string,
  trustedPath = process.env.PATH ?? ''
): Promise<NodeJS.ProcessEnv> {
  const pathDirectories = await resolveTrustedDirectories(workspaceRoot, trustedPath)
  return createBaseEnvironment(pathDirectories, path.dirname(process.execPath))
}

async function resolveTrustedDirectories(
  workspaceRoot: string,
  trustedPath: string
): Promise<string[]> {
  const directories: string[] = []

  for (const entry of trustedPath.split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry)) {
      throw new ToolError('forbidden', 'trustedPath 包含空或相对目录')
    }

    let directory: string
    try {
      directory = await realpath(entry)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        continue
      }
      throw error
    }

    const stat = await lstat(directory)
    if (!stat.isDirectory()) {
      continue
    }
    if (isWithin(workspaceRoot, directory)) {
      throw new ToolError('forbidden', 'trustedPath 不能包含工作区目录')
    }
    if (!directories.some((item) => samePath(item, directory))) {
      directories.push(directory)
    }
  }

  return directories
}

function createBaseEnvironment(pathDirectories: string[], nodeDirectory: string): NodeJS.ProcessEnv {
  const directories = pathDirectories.some((item) => samePath(item, nodeDirectory))
    ? pathDirectories
    : [nodeDirectory, ...pathDirectories]
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const env: NodeJS.ProcessEnv = {
    PATH: directories.join(path.delimiter),
    CI: '1',
    NO_COLOR: '1',
    GIT_PAGER: '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_SYSTEM: nullDevice,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false'
  }

  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot
    if (!systemRoot || !path.isAbsolute(systemRoot)) {
      throw new ToolError('internal', '缺少可信的 SystemRoot')
    }
    env.SystemRoot = systemRoot
    env.ComSpec = path.join(systemRoot, 'System32', 'cmd.exe')
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
  }

  return env
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as NodeJS.ErrnoException).code === code
}
