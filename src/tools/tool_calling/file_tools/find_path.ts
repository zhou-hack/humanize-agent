import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import { resolveWorkspaceEntry, type Workspace, type WorkspaceEntry } from './workspace.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_MAX_DEPTH = 8
const MAX_DEPTH = 32
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules'])

interface FindPathArgs {
  path?: string
  name: string
  max_depth?: number
  limit?: number
}

interface PendingEntry {
  entry: WorkspaceEntry
  depth: number
}

export function createFindPathTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'find_path',
    description: '按不区分大小写的精确名称递归查找工作区内的文件或目录，不读取内容。path 默认工作区根目录，max_depth 默认 8，limit 默认 50；跳过 .git 和 node_modules。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        max_depth: { type: 'integer', minimum: 0, maximum: MAX_DEPTH },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }
      },
      required: ['name'],
      additionalProperties: false
    },
    effect: 'read',
    untrustedResult: true,
    handler: async (args) => {
      const input = args as FindPathArgs
      const root = await resolveWorkspaceEntry(workspace, input.path ?? '.', true)
      if (root.type === 'other') {
        throw new ToolError('unsupported_file', '查找目标必须是常规文件或目录')
      }
      const limit = input.limit ?? DEFAULT_LIMIT
      const maximumDepth = input.max_depth ?? DEFAULT_MAX_DEPTH
      const needle = input.name.toLocaleLowerCase()
      const matches: Array<{ path: string; type: string }> = []
      const pending: PendingEntry[] = [{ entry: root, depth: 0 }]

      while (pending.length > 0 && matches.length <= limit) {
        const current = pending.shift() as PendingEntry
        const { entry, depth } = current
        if (entryName(entry).toLocaleLowerCase() === needle) {
          matches.push({ path: entry.relativePath, type: entry.type })
        }
        if (matches.length > limit) break
        if (entry.type !== 'directory' || depth >= maximumDepth) continue

        const children = await readdir(entry.absolutePath, { withFileTypes: true })
        children.sort((left, right) => left.name.localeCompare(right.name))
        for (const child of children) {
          if (child.isSymbolicLink()) continue
          if (child.isDirectory() && IGNORED_DIRECTORY_NAMES.has(child.name)) continue
          const type = child.isFile() ? 'file' : child.isDirectory() ? 'directory' : 'other'
          if (type === 'other') continue
          const relativePath = entry.relativePath === '.'
            ? child.name
            : `${entry.relativePath}/${child.name}`
          const childEntry: WorkspaceEntry = {
            absolutePath: path.join(entry.absolutePath, child.name),
            relativePath,
            size: 0,
            mode: 0,
            type
          }
          pending.push({ entry: childEntry, depth: depth + 1 })
          if (matches.length > limit) break
        }
      }

      const hasMore = matches.length > limit
      return {
        path: root.relativePath,
        name: input.name,
        matches: matches.slice(0, limit),
        has_more: hasMore,
        scan_complete: !hasMore
      }
    }
  }
}

function entryName(entry: WorkspaceEntry): string {
  return entry.relativePath === '.' ? '' : path.basename(entry.relativePath)
}
