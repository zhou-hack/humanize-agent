import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { ToolDefinition } from '../types.js'
import { resolveWorkspaceFile, type Workspace } from './workspace.js'

const MAX_EDIT_BYTES = 2 * 1024 * 1024

interface EditFileArgs {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export function createEditFileTool(workspace: Workspace): ToolDefinition {
  return {
    name: 'edit_file',
    description:
      '精确替换工作区内已有 UTF-8 文本文件的内容，不创建文件。old_string 默认必须唯一匹配；replace_all 为 true 时替换全部非重叠匹配。编辑会直接写入，失败时不保留临时文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        old_string: { type: 'string', minLength: 1 },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false
    },
    effect: 'write',
    handler: async (args) => {
      const {
        path: inputPath,
        old_string: oldString,
        new_string: newString,
        replace_all: replaceAll = false
      } = args as EditFileArgs
      const file = await resolveWorkspaceFile(workspace, inputPath)

      if (file.size > MAX_EDIT_BYTES) {
        throw new ToolError('limit_exceeded', '文件超过 2 MiB 编辑上限')
      }

      const original = await readFile(file.absolutePath)
      const content = decodeText(original)
      const matches = findMatches(content, oldString)

      if (matches === 0) {
        throw new ToolError('conflict', 'old_string 未匹配，文件未修改')
      }

      if (matches > 1 && !replaceAll) {
        throw new ToolError('conflict', 'old_string 有多处匹配，请提供更精确的文本或启用 replace_all')
      }

      if (oldString === newString) {
        return { path: file.relativePath, replacements: 0, changed: false }
      }

      const updated = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, () => newString)
      const output = Buffer.from(updated, 'utf8')

      if (output.length > MAX_EDIT_BYTES) {
        throw new ToolError('limit_exceeded', '编辑结果超过 2 MiB 上限')
      }

      await writeAtomically(workspace, file, original, output)

      return { path: file.relativePath, replacements: matches, changed: true }
    }
  }
}

async function writeAtomically(
  workspace: Workspace,
  file: Awaited<ReturnType<typeof resolveWorkspaceFile>>,
  original: Buffer,
  output: Buffer
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(file.absolutePath),
    `.${path.basename(file.absolutePath)}.${process.pid}.${randomUUID()}.tmp`
  )
  let temporaryExists = false

  try {
    const handle = await open(temporaryPath, 'wx', file.mode)
    temporaryExists = true

    try {
      await handle.writeFile(output)
      await handle.sync()
    } finally {
      await handle.close()
    }

    const current = await resolveWorkspaceFile(workspace, file.relativePath)
    const latest = await readFile(current.absolutePath)

    if (!latest.equals(original)) {
      throw new ToolError('conflict', '文件已被外部修改，未覆盖写入')
    }

    try {
      await rename(temporaryPath, current.absolutePath)
    } catch (error) {
      if (isWriteConflict(error)) {
        throw new ToolError('conflict', '文件当前被占用或锁定，请稍后重试')
      }
      throw error
    }

    temporaryExists = false
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

function findMatches(content: string, oldString: string): number {
  let count = 0
  let offset = 0

  while (offset <= content.length - oldString.length) {
    const index = content.indexOf(oldString, offset)
    if (index === -1) {
      break
    }
    count += 1
    offset = index + oldString.length
  }

  return count
}

function decodeText(buffer: Buffer): string {
  if (buffer.includes(0)) {
    throw new ToolError('unsupported_file', '不支持二进制文件')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    throw new ToolError('unsupported_file', '文件不是有效的 UTF-8 文本')
  }
}

function isWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }

  const code = (error as NodeJS.ErrnoException).code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EEXIST'
}
