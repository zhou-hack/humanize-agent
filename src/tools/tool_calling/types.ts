export type ToolEffect = 'read' | 'write' | 'send'

export type ToolErrorCode =
  | 'unknown_tool'
  | 'invalid_args'
  | 'not_found'
  | 'limit_exceeded'
  | 'forbidden'
  | 'sensitive'
  | 'timeout'
  | 'conflict'
  | 'unsupported_file'
  | 'internal'

export interface ToolContext {
  conversationId: string
  imageIds: string[]
  untrustedSeen: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  effect: ToolEffect
  timeoutMs?: number
  untrustedResult?: boolean
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: unknown
}

export type ToolResult =
  | { ok: true; data: unknown; truncated?: boolean }
  | {
      ok: false
      error: { code: ToolErrorCode; message: string; retryable: boolean }
    }

export interface ToolExecutorOptions {
  timeoutMs?: number
  maxResultChars?: number
}
