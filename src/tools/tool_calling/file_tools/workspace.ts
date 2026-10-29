import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'

export interface Workspace {
  readonly root: string
}

export interface WorkspaceFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly size: number
  readonly mode: number
}

export interface WorkspaceDirectory {
  readonly absolutePath: string
  readonly relativePath: string
}

export interface WorkspaceEntry extends WorkspaceFile {
  readonly type: 'file' | 'directory' | 'other'
}

export interface WorkspaceDestination {
  readonly absolutePath: string
  readonly relativePath: string
}

export async function createWorkspace(workspaceRoot: string): Promise<Workspace> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new TypeError('workspaceRoot 必须是绝对路径')
  }

  const root = await realpath(workspaceRoot)
  const stat = await lstat(root)

  if (!stat.isDirectory()) {
    throw new TypeError('workspaceRoot 必须是目录')
  }

  return { root }
}

export async function resolveWorkspaceFile(
  workspace: Workspace,
  inputPath: string
): Promise<WorkspaceFile> {
  const entry = await resolveWorkspaceEntry(workspace, inputPath)
  if (entry.type !== 'file') {
    throw new ToolError('unsupported_file', '目标不是常规文件')
  }
  return entry
}

export async function resolveWorkspaceDirectory(
  workspace: Workspace,
  inputPath: string
): Promise<WorkspaceDirectory> {
  const entry = await resolveWorkspaceEntry(workspace, inputPath, true)
  if (entry.type !== 'directory') {
    throw new ToolError('unsupported_file', '目标不是目录')
  }
  return entry
}

export async function resolveWorkspaceDestination(
  workspace: Workspace,
  inputPath: string
): Promise<WorkspaceDestination> {
  const segments = parseRelativePath(inputPath, false)
  const parentPath = segments.slice(0, -1).join('/') || '.'
  const parent = await resolveWorkspaceDirectory(workspace, parentPath)
  const name = segments.at(-1) as string
  const absolutePath = path.resolve(parent.absolutePath, name)

  if (!isWithin(workspace.root, absolutePath)) {
    throw new ToolError('forbidden', '目标路径超出工作区')
  }
  return { absolutePath, relativePath: segments.join('/') }
}

export async function resolveWorkspaceEntry(
  workspace: Workspace,
  inputPath: string,
  allowRoot = false
): Promise<WorkspaceEntry> {
  const segments = parseRelativePath(inputPath, allowRoot)
  const candidate = path.resolve(workspace.root, ...segments)

  if (!isWithin(workspace.root, candidate)) {
    throw new ToolError('forbidden', '文件路径超出工作区')
  }

  let current = workspace.root

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    const stat = await lstat(current)

    if (stat.isSymbolicLink()) {
      throw new ToolError('forbidden', '不允许通过符号链接访问文件')
    }

    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new ToolError('not_found', '文件路径中的父目录不存在')
    }
  }

  const absolutePath = await realpath(candidate)

  if (!isWithin(workspace.root, absolutePath)) {
    throw new ToolError('forbidden', '文件路径超出工作区')
  }

  const stat = await lstat(absolutePath)
  return {
    absolutePath,
    relativePath: segments.length === 0 ? '.' : segments.join('/'),
    size: stat.size,
    mode: stat.mode,
    type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'
  }
}

function parseRelativePath(inputPath: string, allowRoot: boolean): string[] {
  if (
    !inputPath ||
    /[\u0000-\u001f]/u.test(inputPath) ||
    path.posix.isAbsolute(inputPath) ||
    path.win32.isAbsolute(inputPath) ||
    /^[a-zA-Z]:/u.test(inputPath)
  ) {
    throw new ToolError('invalid_args', 'path 必须是工作区内的相对路径')
  }

  const normalized = inputPath.replaceAll('\\', '/')

  if (normalized.startsWith('/') || (process.platform === 'win32' && normalized.includes(':'))) {
    throw new ToolError('invalid_args', 'path 包含不允许的路径格式')
  }

  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')

  if (segments.length === 0 && allowRoot) return []
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new ToolError('invalid_args', 'path 不能包含路径穿越')
  }

  return segments
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}
