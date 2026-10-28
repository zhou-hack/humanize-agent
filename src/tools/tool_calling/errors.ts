import type { ToolErrorCode, ToolResult } from './types.js'

const RETRYABLE_ERRORS: Record<ToolErrorCode, boolean> = {
  unknown_tool: false,
  invalid_args: true,
  not_found: false,
  limit_exceeded: true,
  forbidden: false,
  sensitive: false,
  timeout: true,
  conflict: true,
  unsupported_file: false,
  internal: false
}

export class ToolError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code: ToolErrorCode,
    message: string,
    retryable = RETRYABLE_ERRORS[code]
  ) {
    super(message)
    this.name = 'ToolError'
    this.retryable = retryable
  }
}

export function failure(error: unknown): ToolResult {
  const toolError = normalizeError(error)

  return {
    ok: false,
    error: {
      code: toolError.code,
      message: toolError.message,
      retryable: toolError.retryable
    }
  }
}

export function normalizeError(error: unknown): ToolError {
  if (error instanceof ToolError) {
    return error
  }

  const code = getNodeErrorCode(error)

  if (code === 'ENOENT') {
    return new ToolError('not_found', '文件或路径不存在')
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return new ToolError('forbidden', '没有权限访问该文件')
  }

  if (code === 'EISDIR') {
    return new ToolError('unsupported_file', '目标不是常规文件')
  }

  return new ToolError('internal', '工具执行失败')
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' ? code : undefined
}
