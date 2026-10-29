import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import {
  resolveWorkspaceEntry,
  type Workspace,
  type WorkspaceEntry
} from '../file_tools/workspace.js'

export const DEFAULT_READONLY_SCAN_LIMIT = 10_000

export interface ReadonlyPathOptions {
  recursive?: boolean
  scanLimit?: number
  allowOutsideWorkspace?: boolean
}

export type ReadonlyWorkspaceEntry = WorkspaceEntry

export async function resolveReadonlyPath(
  workspace: Workspace,
  inputPath: string,
  expected: 'file' | 'directory' | 'either' = 'either',
  options: ReadonlyPathOptions = {}
): Promise<ReadonlyWorkspaceEntry> {
  assertNonSensitivePath(inputPath)
  const entry = options.allowOutsideWorkspace && path.isAbsolute(inputPath)
    ? await resolveExternalEntry(inputPath)
    : await resolveWorkspaceEntry(workspace, inputPath, true)

  if (expected === 'file' && entry.type !== 'file') {
    throw new ToolError('unsupported_file', '命令參數必須是常規檔案')
  }
  if (expected === 'directory' && entry.type !== 'directory') {
    throw new ToolError('unsupported_file', '命令參數必須是目錄')
  }
  if (entry.type === 'other') {
    throw new ToolError('unsupported_file', '命令參數必須是常規檔案或目錄')
  }

  if (options.recursive && entry.type === 'directory') {
    await preflightDirectoryTree(workspace, entry, options.scanLimit ?? DEFAULT_READONLY_SCAN_LIMIT)
  }
  return entry
}

async function resolveExternalEntry(inputPath: string): Promise<ReadonlyWorkspaceEntry> {
  if (
    /[\u0000-\u001f]/u.test(inputPath) ||
    (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/u.test(inputPath) || inputPath.slice(2).includes(':')))
  ) {
    throw new ToolError('forbidden', '僅允許本機絕對路徑，不接受 UNC、ADS 或控制字元')
  }

  const candidate = path.resolve(inputPath)
  const root = path.parse(candidate).root
  const segments = path.relative(root, candidate).split(path.sep).filter(Boolean)
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) {
      throw new ToolError('forbidden', '不允許通過符號連結或 junction 讀取外部路徑')
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new ToolError('not_found', '外部路徑中的父目錄不存在')
    }
  }

  const absolutePath = await realpath(candidate)
  const stat = await lstat(absolutePath)
  return {
    absolutePath,
    relativePath: absolutePath,
    size: stat.size,
    mode: stat.mode,
    type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'
  }
}

export function assertNonSensitivePath(inputPath: string): void {
  const normalized = inputPath.replaceAll('\\', '/').replace(/^\.\//u, '')
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')

  for (const segment of segments) {
    if (isSensitiveSegment(segment)) {
      throw new ToolError('sensitive', '命令不能讀取敏感檔案、Git 內部資料或執行期記憶')
    }
  }

  const lower = segments.map((segment) => segment.toLowerCase()).join('/')
  if (lower === 'src/data/memory' || lower.startsWith('src/data/memory/')) {
    throw new ToolError('sensitive', '命令不能讀取專案執行期記憶')
  }
}

async function preflightDirectoryTree(
  workspace: Workspace,
  root: WorkspaceEntry,
  scanLimit: number
): Promise<void> {
  if (!Number.isSafeInteger(scanLimit) || scanLimit <= 0) {
    throw new TypeError('scanLimit 必須是正整數')
  }

  const queue: WorkspaceEntry[] = [root]
  let scanned = 0

  while (queue.length > 0) {
    const directory = queue.shift() as WorkspaceEntry
    const children = await readdir(directory.absolutePath, { withFileTypes: true })

    for (const child of children) {
      scanned += 1
      if (scanned > scanLimit) {
        throw new ToolError('limit_exceeded', `遞迴命令預檢超過 ${scanLimit} 個項目`)
      }

      const relativePath = directory.relativePath === '.'
        ? child.name
        : `${directory.relativePath}/${child.name}`
      assertNonSensitivePath(relativePath)
      const absolutePath = path.join(directory.absolutePath, child.name)
      const stat = await lstat(absolutePath)

      if (stat.isSymbolicLink()) {
        throw new ToolError('forbidden', '遞迴命令目標包含符號連結或 junction')
      }
      if (stat.isDirectory()) {
        queue.push({
          absolutePath,
          relativePath,
          size: stat.size,
          mode: stat.mode,
          type: 'directory'
        })
      } else if (!stat.isFile()) {
        throw new ToolError('unsupported_file', '遞迴命令目標包含非常規檔案')
      }
    }
  }
}

function isSensitiveSegment(segment: string): boolean {
  const name = segment.toLowerCase()
  if (
    name === '.git' ||
    name.startsWith('.env') ||
    name === '.ssh' ||
    name === '.aws' ||
    name === '.gnupg' ||
    name === '.netrc' ||
    name === '.npmrc' ||
    name === 'memory.md' ||
    /^memory\.db(?:[-.]|$)/u.test(name) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/u.test(name) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|ppk)$/u.test(name) ||
    /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/u.test(name)
  ) {
    return true
  }
  return false
}
