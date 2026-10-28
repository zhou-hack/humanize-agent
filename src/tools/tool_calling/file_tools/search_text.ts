import { isUtf8 } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import {
  resolveWorkspaceEntry,
  resolveWorkspaceFile,
  type Workspace,
  type WorkspaceEntry
} from './workspace.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_SCAN_FILES = 1000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LINE_CHARS = 500

interface SearchTextArgs {
  path?: string
  query: string
  limit?: number
  case_sensitive?: boolean
}

interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
}

export function createSearchTextTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'search_text',
    description: '在工作区内的单个 UTF-8 文件或目录中递归搜索字面量文本，不执行正则或外部命令。返回匹配文件、行号、列号和该行内容；path 省略时为工作区根目录，limit 默认 50、最大 200。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        case_sensitive: { type: 'boolean' }
      },
      required: ['query'],
      additionalProperties: false
    },
    effect: 'read',
    untrustedResult: true,
    handler: async (args) => {
      const input = args as SearchTextArgs
      if (input.query.includes('\n') || input.query.includes('\r')) {
        throw new ToolError('invalid_args', 'query 只能搜索单行文本')
      }
      const limit = input.limit ?? DEFAULT_LIMIT
      const root = await resolveWorkspaceEntry(workspace, input.path ?? '.', true)
      if (root.type === 'other') {
        throw new ToolError('unsupported_file', '搜索目标必须是常规文件或目录')
      }

      const state = {
        matches: [] as SearchMatch[],
        scannedFiles: 0,
        skippedFiles: 0,
        scanComplete: true
      }
      await searchEntry(
        workspace,
        root,
        input.query,
        input.case_sensitive ?? true,
        limit + 1,
        state
      )
      const hasMore = state.matches.length > limit
      return {
        path: root.relativePath,
        query: input.query,
        matches: state.matches.slice(0, limit),
        has_more: hasMore,
        scan_complete: state.scanComplete && !hasMore,
        scanned_files: state.scannedFiles,
        skipped_files: state.skippedFiles
      }
    }
  }
}

async function searchEntry(
  workspace: Workspace,
  root: WorkspaceEntry,
  query: string,
  caseSensitive: boolean,
  maximumMatches: number,
  state: {
    matches: SearchMatch[]
    scannedFiles: number
    skippedFiles: number
    scanComplete: boolean
  }
): Promise<void> {
  const pending: WorkspaceEntry[] = [root]

  while (pending.length > 0 && state.matches.length < maximumMatches) {
    if (state.scannedFiles + state.skippedFiles >= MAX_SCAN_FILES) {
      state.scanComplete = false
      return
    }
    const entry = pending.shift() as WorkspaceEntry
    if (entry.type === 'directory') {
      const children = await readdir(entry.absolutePath, { withFileTypes: true })
      children.sort((left, right) => left.name.localeCompare(right.name))
      for (const child of children) {
        if (child.isSymbolicLink()) continue
        const type = child.isFile() ? 'file' : child.isDirectory() ? 'directory' : 'other'
        if (type === 'other') continue
        pending.push({
          absolutePath: path.join(entry.absolutePath, child.name),
          relativePath: entry.relativePath === '.'
            ? child.name
            : `${entry.relativePath}/${child.name}`,
          size: 0,
          mode: 0,
          type
        })
      }
      continue
    }

    await searchFile(workspace, entry.relativePath, query, caseSensitive, maximumMatches, state)
  }
}

async function searchFile(
  workspace: Workspace,
  relativePath: string,
  query: string,
  caseSensitive: boolean,
  maximumMatches: number,
  state: {
    matches: SearchMatch[]
    scannedFiles: number
    skippedFiles: number
    scanComplete: boolean
  }
): Promise<void> {
  const file = await resolveWorkspaceFile(workspace, relativePath)
  if (file.size > MAX_FILE_BYTES) {
    state.skippedFiles += 1
    return
  }
  const bytes = await readFile(file.absolutePath)
  if (bytes.includes(0) || !isUtf8(bytes)) {
    state.skippedFiles += 1
    return
  }

  state.scannedFiles += 1
  const content = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const lines = content.split(/\r\n|\n|\r/)
  for (const [index, line] of lines.entries()) {
    const haystack = caseSensitive ? line : line.toLocaleLowerCase()
    const column = haystack.indexOf(needle)
    if (column < 0) continue
    state.matches.push({
      path: file.relativePath,
      line: index + 1,
      column: column + 1,
      text: truncateLine(line)
    })
    if (state.matches.length >= maximumMatches) return
  }
}

function truncateLine(line: string): string {
  const characters = Array.from(line)
  return characters.length <= MAX_LINE_CHARS
    ? line
    : `${characters.slice(0, MAX_LINE_CHARS).join('')}…`
}
