import { lstat } from 'node:fs/promises'
import { normalizeError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import { resolveWorkspaceEntry, type Workspace } from './workspace.js'

export function createStatPathTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'stat_path',
    description: '检查工作区内精确路径是否存在，返回文件或目录类型、大小、模式和修改时间；不存在时返回 exists=false，不读取文件内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 }
      },
      required: ['path'],
      additionalProperties: false
    },
    effect: 'read',
    untrustedResult: true,
    handler: async (args) => {
      const input = args as { path: string }
      try {
        const entry = await resolveWorkspaceEntry(workspace, input.path, true)
        const metadata = await lstat(entry.absolutePath)
        return {
          path: entry.relativePath,
          exists: true,
          type: entry.type,
          size: entry.size,
          mode: entry.mode,
          modified_at: metadata.mtime.toISOString()
        }
      } catch (error) {
        if (normalizeError(error).code === 'not_found') {
          return { path: input.path, exists: false }
        }
        throw error
      }
    }
  }
}
