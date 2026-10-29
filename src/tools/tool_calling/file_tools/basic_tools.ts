import { lstat, mkdir, rename, rm, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import {
  resolveWorkspaceDestination,
  resolveWorkspaceEntry,
  type Workspace
} from './workspace.js'

export function createGetWorkspaceDirectoryTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'get_workspace_directory',
    description: '获取当前工作区的绝对路径，相当于 pwd，不读取目录内容。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    effect: 'read',
    handler: async () => ({ path: workspace.root })
  }
}

export function createCreateDirectoryTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'create_directory',
    description: '在当前工作区内创建一个目录，相当于 mkdir；父目录必须已存在，不覆盖已有文件或目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 }
      },
      required: ['path'],
      additionalProperties: false
    },
    effect: 'write',
    handler: async (args) => {
      const input = args as { path: string }
      const destination = await resolveWorkspaceDestination(workspace, input.path)
      await assertDestinationMissing(destination.absolutePath)
      await mkdir(destination.absolutePath)
      return { path: destination.relativePath, created: true }
    }
  }
}

export function createMovePathTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'move_path',
    description: '在当前工作区内移动或重命名文件、目录，相当于 move；不覆盖已有目标，不允许把目录移入自身。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', minLength: 1 },
        destination: { type: 'string', minLength: 1 }
      },
      required: ['source', 'destination'],
      additionalProperties: false
    },
    effect: 'write',
    handler: async (args) => {
      const input = args as { source: string; destination: string }
      const source = await resolveWorkspaceEntry(workspace, input.source)
      if (source.type === 'other') {
        throw new ToolError('unsupported_file', '只能移动常规文件或目录')
      }
      const destination = await resolveWorkspaceDestination(workspace, input.destination)
      if (source.type === 'directory' && isInsideDirectory(source.absolutePath, destination.absolutePath)) {
        throw new ToolError('invalid_args', '不能把目录移动到自身内部')
      }
      await assertDestinationMissing(destination.absolutePath)
      await rename(source.absolutePath, destination.absolutePath)
      return {
        source: source.relativePath,
        destination: destination.relativePath,
        moved: true
      }
    }
  }
}

export function createDeletePathTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'delete_path',
    description: '删除当前工作区内的文件或空目录；仅在 recursive=true 时递归删除非空目录，禁止删除工作区根目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        recursive: { type: 'boolean' }
      },
      required: ['path'],
      additionalProperties: false
    },
    effect: 'write',
    handler: async (args) => {
      const input = args as { path: string; recursive?: boolean }
      const entry = await resolveWorkspaceEntry(workspace, input.path)
      if (entry.type === 'other') {
        throw new ToolError('unsupported_file', '只能删除常规文件或目录')
      }

      if (entry.type === 'file') {
        await unlink(entry.absolutePath)
      } else if (input.recursive === true) {
        await rm(entry.absolutePath, { recursive: true, force: false })
      } else {
        try {
          await rmdir(entry.absolutePath)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOTEMPTY' || code === 'EEXIST') {
            throw new ToolError('conflict', '目录非空；确认需要递归删除时显式设置 recursive=true')
          }
          throw error
        }
      }
      return { path: entry.relativePath, type: entry.type, deleted: true }
    }
  }
}

async function assertDestinationMissing(absolutePath: string): Promise<void> {
  try {
    await lstat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new ToolError('conflict', '目标路径已存在，不会覆盖')
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate)
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
