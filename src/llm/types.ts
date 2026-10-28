import type { ToolDefinition } from '../tools/tool_calling/types.js'

export interface LlmTextBlock {
  type: 'text'
  text: string
}

export interface LlmToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface LlmToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export type LlmInputBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock
export type LlmOutputBlock = LlmTextBlock | LlmToolUseBlock

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | LlmInputBlock[]
}

export interface LlmRequest {
  messages: LlmMessage[]
  system?: string
  tools?: ToolDefinition[]
  model?: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface LlmResponse {
  id: string
  model: string
  stopReason: string | null
  content: LlmOutputBlock[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>
  stream(request: LlmRequest, onText?: (delta: string) => void): Promise<LlmResponse>
}
