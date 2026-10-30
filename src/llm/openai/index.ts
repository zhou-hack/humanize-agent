import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import OpenAI from 'openai'
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
  ResponseInputItem
} from 'openai/resources/responses/responses'
import type { LlmClient, LlmOutputBlock, LlmRequest, LlmResponse } from '../types.js'
import { OpenAIChatCompletionsLlmClient } from './chat_completions.js'
import { normalizeOpenAIError, OpenAIClientError } from './errors.js'

const DEFAULT_MAX_TOKENS = 4096

export type OpenAIApiMode = 'responses' | 'chat_completions'

export interface OpenAIClientOptions {
  apiKey?: string
  baseURL?: string
  model?: string
  maxTokens?: number
  apiMode?: OpenAIApiMode
  envPath?: string | false
  client?: OpenAI
}

export class OpenAILlmClient implements LlmClient {
  constructor(
    private readonly client: OpenAI,
    private readonly defaultModel: string,
    private readonly defaultMaxTokens: number
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.responses.create(this.createParams(request), {
        signal: request.signal
      })
      return mapResponse(response)
    } catch (error) {
      throw normalizeOpenAIError(error)
    }
  }

  async stream(
    request: LlmRequest,
    onText?: (delta: string) => void,
    onThinking?: (delta: string) => void
  ): Promise<LlmResponse> {
    try {
      const stream = this.client.responses.stream({
        ...this.createParams(request),
        stream: true
      }, {
        signal: request.signal
      })
      if (onText) {
        stream.on('response.output_text.delta', (event) => onText(event.delta))
      }
      if (onThinking) {
        stream.on('response.reasoning_text.delta', (event) => onThinking(event.delta))
        stream.on('response.reasoning_summary_text.delta', (event) => onThinking(event.delta))
      }
      return mapResponse(await stream.finalResponse())
    } catch (error) {
      throw normalizeOpenAIError(error)
    }
  }

  private createParams(request: LlmRequest): ResponseCreateParamsNonStreaming {
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new OpenAIClientError('config', 'maxTokens 必须是正整数', false)
    }

    return {
      model: request.model ?? this.defaultModel,
      input: toResponseInput(request.messages),
      max_output_tokens: maxTokens,
      ...(request.system !== undefined ? { instructions: request.system } : {}),
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools.map((tool): FunctionTool => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false
          })) }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.effort !== undefined ? { reasoning: { effort: request.effort } } : {})
    } as ResponseCreateParamsNonStreaming
  }
}

export function createOpenAIClient(options: OpenAIClientOptions = {}): LlmClient {
  loadEnvironment(options.envPath)
  const apiMode = resolveApiMode(options.apiMode ?? process.env.OPENAI_API_MODE)
  const model = options.model ?? process.env.OPENAI_MODEL
  if (!model) {
    throw new OpenAIClientError('config', '缺少 OPENAI_MODEL 配置', false)
  }
  const maxTokens = options.maxTokens ?? readMaxTokens()
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new OpenAIClientError('config', 'OPENAI_MAX_TOKENS 必须是正整数', false)
  }

  let client = options.client
  if (!client) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new OpenAIClientError('config', '缺少 OPENAI_API_KEY 配置', false)
    }
    const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL
    client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }

  return apiMode === 'chat_completions'
    ? new OpenAIChatCompletionsLlmClient(client, model, maxTokens)
    : new OpenAILlmClient(client, model, maxTokens)
}

function resolveApiMode(value: string | undefined): OpenAIApiMode {
  if (!value || value === 'responses') return 'responses'
  if (value === 'chat_completions') return 'chat_completions'
  throw new OpenAIClientError('config', 'OPENAI_API_MODE 必须是 responses 或 chat_completions', false)
}

function toResponseInput(messages: LlmRequest['messages']): ResponseInput {
  return messages.flatMap((message) => {
    if (typeof message.content === 'string') {
      return [{ role: message.role, content: message.content }]
    }

    return message.content.flatMap((block): ResponseInputItem[] => {
      switch (block.type) {
        case 'text':
          return [{ role: message.role, content: block.text }]
        case 'thinking':
          return []
        case 'tool_use':
          return [{
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input)
          }]
        case 'tool_result':
          return [{
            type: 'function_call_output',
            call_id: block.toolUseId,
            output: block.content
          }]
      }
    })
  })
}

function mapResponse(response: Response): LlmResponse {
  if (response.error) {
    throw new OpenAIClientError('api', 'OpenAI 响应生成失败', false)
  }
  return {
    id: response.id,
    model: response.model,
    stopReason: response.incomplete_details?.reason ?? response.status ?? null,
    content: response.output.flatMap((item): LlmOutputBlock[] => {
      if (item.type === 'reasoning') {
        const parts = item.content?.length ? item.content : item.summary
        const thinking = parts.map((part) => part.text).join('\n')
        return thinking ? [{ type: 'thinking', thinking }] : []
      }
      if (item.type === 'message') {
        return item.content.flatMap((block): LlmOutputBlock[] =>
          block.type === 'output_text' ? [{ type: 'text', text: block.text }] : []
        )
      }
      if (item.type === 'function_call') {
        return [{
          type: 'tool_use',
          id: item.call_id,
          name: item.name,
          input: parseArguments(item.arguments)
        }]
      }
      return []
    }),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0
    }
  }
}

function parseArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch {
    return argumentsJson
  }
}

function loadEnvironment(envPath: string | false | undefined): void {
  if (envPath === false) return
  const filePath = resolve(envPath ?? '.env')
  if (existsSync(filePath)) loadEnvFile(filePath)
}

function readMaxTokens(): number {
  const value = process.env.OPENAI_MAX_TOKENS
  return value === undefined ? DEFAULT_MAX_TOKENS : Number(value)
}

export { OpenAIChatCompletionsLlmClient } from './chat_completions.js'
export { OpenAIClientError, type OpenAIClientErrorCode } from './errors.js'
