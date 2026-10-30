import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import {
  Anthropic,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool
} from '@anthropic-ai/sdk/resources/messages'
import type { LlmClient, LlmOutputBlock, LlmRequest, LlmResponse } from '../types.js'

const DEFAULT_MAX_TOKENS = 4096

export interface AnthropicClientOptions {
  apiKey?: string
  baseURL?: string
  model?: string
  maxTokens?: number
  envPath?: string | false
  client?: Anthropic
}

export type AnthropicClientErrorCode =
  | 'config'
  | 'authentication'
  | 'permission'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limit'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'api'

export class AnthropicClientError extends Error {
  constructor(
    readonly code: AnthropicClientErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message)
    this.name = 'AnthropicClientError'
  }
}

export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly client: Anthropic,
    private readonly defaultModel: string,
    private readonly defaultMaxTokens: number
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const message = await this.client.messages.create(this.createParams(request), {
        signal: request.signal
      })
      return mapResponse(message)
    } catch (error) {
      throw normalizeError(error)
    }
  }

  async stream(
    request: LlmRequest,
    onText?: (delta: string) => void,
    onThinking?: (delta: string) => void
  ): Promise<LlmResponse> {
    try {
      const stream = this.client.messages.stream(this.createParams(request), {
        signal: request.signal
      })
      if (onText) stream.on('text', (delta) => onText(delta))
      if (onThinking) stream.on('thinking', (delta) => onThinking(delta))
      return mapResponse(await stream.finalMessage())
    } catch (error) {
      throw normalizeError(error)
    }
  }

  private createParams(request: LlmRequest): MessageCreateParamsNonStreaming {
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AnthropicClientError('config', 'maxTokens 必须是正整数', false)
    }

    return {
      model: request.model ?? this.defaultModel,
      max_tokens: maxTokens,
      messages: request.messages.map(toMessageParam),
      ...(request.system !== undefined ? { system: request.system } : {}),
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Tool.InputSchema
          })) }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.effort !== undefined ? { output_config: { effort: request.effort } } : {})
    } as MessageCreateParamsNonStreaming
  }
}

export function createAnthropicClient(options: AnthropicClientOptions = {}): AnthropicLlmClient {
  loadEnvironment(options.envPath)
  const model = options.model ?? process.env.ANTHROPIC_MODEL
  if (!model) {
    throw new AnthropicClientError('config', '缺少 ANTHROPIC_MODEL 配置', false)
  }
  const maxTokens = options.maxTokens ?? readMaxTokens()
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new AnthropicClientError('config', 'ANTHROPIC_MAX_TOKENS 必须是正整数', false)
  }

  if (options.client) {
    return new AnthropicLlmClient(options.client, model, maxTokens)
  }
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new AnthropicClientError('config', '缺少 ANTHROPIC_API_KEY 配置', false)
  }
  const baseURL = options.baseURL ?? process.env.ANTHROPIC_BASE_URL
  return new AnthropicLlmClient(
    new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) }),
    model,
    maxTokens
  )
}

function toMessageParam(message: LlmRequest['messages'][number]): MessageParam {
  return {
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((block): ContentBlockParam[] => {
          switch (block.type) {
            case 'text':
              return [{ type: 'text', text: block.text }]
            // 没有签名的思考块（来自其他协议）无法回传给 Anthropic
            case 'thinking':
              return block.signature
                ? [{ type: 'thinking', thinking: block.thinking, signature: block.signature }]
                : []
            case 'tool_use':
              return [{
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input
              }]
            case 'tool_result':
              return [{
                type: 'tool_result',
                tool_use_id: block.toolUseId,
                content: block.content,
                ...(block.isError !== undefined ? { is_error: block.isError } : {})
              }]
          }
        })
  } as MessageParam
}

function mapResponse(message: Message): LlmResponse {
  return {
    id: message.id,
    model: message.model,
    stopReason: message.stop_reason,
    content: message.content.flatMap((block): LlmOutputBlock[] => {
      if (block.type === 'text') return [{ type: 'text' as const, text: block.text }]
      if (block.type === 'thinking') {
        return [{ type: 'thinking' as const, thinking: block.thinking, signature: block.signature }]
      }
      if (block.type === 'tool_use') {
        return [{
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input
        }]
      }
      return []
    }),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    }
  }
}

function loadEnvironment(envPath: string | false | undefined): void {
  if (envPath === false) return
  const filePath = resolve(envPath ?? '.env')
  if (existsSync(filePath)) loadEnvFile(filePath)
}

function readMaxTokens(): number {
  const value = process.env.ANTHROPIC_MAX_TOKENS
  return value === undefined ? DEFAULT_MAX_TOKENS : Number(value)
}

function normalizeError(error: unknown): AnthropicClientError {
  if (error instanceof AnthropicClientError) return error
  if (error instanceof APIUserAbortError || (error instanceof Error && error.name === 'AbortError')) {
    return new AnthropicClientError('aborted', 'Anthropic 请求已取消', false)
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new AnthropicClientError('timeout', 'Anthropic 请求超时', true)
  }
  if (error instanceof APIConnectionError) {
    return new AnthropicClientError('network', '无法连接 Anthropic 服务', true)
  }
  if (error instanceof APIError) {
    const status = error.status
    if (status === 401) return new AnthropicClientError('authentication', 'Anthropic 身份验证失败', false, status)
    if (status === 403) return new AnthropicClientError('permission', '没有权限调用 Anthropic 服务', false, status)
    if (status === 404) return new AnthropicClientError('not_found', 'Anthropic 模型或接口不存在', false, status)
    if (status === 408) return new AnthropicClientError('timeout', 'Anthropic 请求超时', true, status)
    if (status === 429) return new AnthropicClientError('rate_limit', 'Anthropic 请求频率受限', true, status)
    if (status === 400 || status === 422) {
      return new AnthropicClientError('invalid_request', 'Anthropic 请求参数无效', false, status)
    }
    return new AnthropicClientError(
      'api',
      'Anthropic 服务返回错误',
      status !== undefined && status >= 500,
      status
    )
  }
  return new AnthropicClientError('api', 'Anthropic 请求失败', false)
}
