import { readdir } from 'node:fs/promises'
import { ToolError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import { resolveWorkspaceDirectory, type Workspace } from './workspace.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

interface ListDirectoryArgs {
  path?: string
  offset?: number
  limit?: number
}

export function createListDirectoryTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'list_directory',
    description: '列出工作区内一个目录的直接子项，不递归、不跟随符号链接。path 省略或为 . 时表示工作区根目录；offset 和 limit 用于分页，返回名称及类型。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }
      },
      additionalProperties: false
    },
    effect: 'read',
    untrustedResult: true,
    handler: async (args) => {
      const input = args as ListDirectoryArgs
      const offset = input.offset ?? 0
      const limit = input.limit ?? DEFAULT_LIMIT
      const directory = await resolveWorkspaceDirectory(workspace, input.path ?? '.')
      const entries = await readdir(directory.absolutePath, { withFileTypes: true })
      const sorted = entries.map((entry) => ({
        name: entry.name,
        type: entry.isFile()
          ? 'file'
          : entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'other'
      })).sort((left, right) => {
        if (left.type === 'directory' && right.type !== 'directory') return -1
        if (left.type !== 'directory' && right.type === 'directory') return 1
        return left.name.localeCompare(right.name)
      })

      if (offset > sorted.length) {
        throw new ToolError('invalid_args', 'offset 超出目录条目数量')
      }
      const page = sorted.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      return {
        path: directory.relativePath,
        offset,
        next_offset: nextOffset,
        has_more: nextOffset < sorted.length,
        entries: page
      }
    }
  }
}
