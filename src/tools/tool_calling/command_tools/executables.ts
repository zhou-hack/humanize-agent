import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import { COMMAND_DEFINITIONS } from './commands.js'
import type { CommandId, CommandRuntime } from './types.js'

export async function resolveCommandRuntimes(
  workspaceRoot: string,
  trustedPath = process.env.PATH ?? ''
): Promise<Record<CommandId, CommandRuntime>> {
  const pathDirectories = await resolveTrustedDirectories(workspaceRoot, trustedPath)
  const [npmEntry, gitExecutable, nodeExecutable] = await Promise.all([
    findExecutable(pathDirectories, process.platform === 'win32' ? 'npm.cmd' : 'npm', workspaceRoot),
    findExecutable(pathDirectories, process.platform === 'win32' ? 'git.exe' : 'git', workspaceRoot),
    canonicalFile(process.execPath, workspaceRoot)
  ])
  const npmCli = await resolveNpmCli(npmEntry, workspaceRoot)
  const environment = createBaseEnvironment(pathDirectories, path.dirname(nodeExecutable))

  const runtimes = {} as Record<CommandId, CommandRuntime>

  for (const [id, definition] of Object.entries(COMMAND_DEFINITIONS) as [
    CommandId,
    (typeof COMMAND_DEFINITIONS)[CommandId]
  ][]) {
    runtimes[id] = definition.program === 'npm'
      ? {
          executable: nodeExecutable,
          args: [npmCli, ...definition.args],
          env: environment
        }
      : {
          executable: gitExecutable,
          args: definition.args,
          env: environment
        }
  }

  return runtimes
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

async function findExecutable(
  directories: string[],
  fileName: string,
  workspaceRoot: string
): Promise<string> {
  for (const directory of directories) {
    const candidate = path.join(directory, fileName)

    try {
      return await canonicalFile(candidate, workspaceRoot)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        continue
      }
      throw error
    }
  }

  throw new ToolError('not_found', `未找到可信的 ${fileName} 可执行文件`)
}

async function canonicalFile(candidate: string, workspaceRoot: string): Promise<string> {
  const canonical = await realpath(candidate)
  const stat = await lstat(canonical)

  if (!stat.isFile()) {
    throw new ToolError('forbidden', '命令入口不是常规文件')
  }
  if (isWithin(workspaceRoot, canonical)) {
    throw new ToolError('forbidden', '命令入口不能位于工作区内')
  }
  if (process.platform !== 'win32') {
    await access(canonical, constants.X_OK)
  }

  return canonical
}

async function resolveNpmCli(npmEntry: string, workspaceRoot: string): Promise<string> {
  if (path.basename(npmEntry) === 'npm-cli.js') {
    return npmEntry
  }

  const candidate = path.join(
    path.dirname(npmEntry),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  )

  try {
    return await canonicalFile(candidate, workspaceRoot)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      throw new ToolError('internal', '不支持当前 npm 安装布局')
    }
    throw error
  }
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
