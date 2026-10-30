import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import type { LlmClient, LlmOutputBlock, LlmRequest, LlmResponse } from '../types.js'
import { normalizeOpenAIError, OpenAIClientError } from './errors.js'

export class OpenAIChatCompletionsLlmClient implements LlmClient {
  constructor(
    private readonly client: OpenAI,
    private readonly defaultModel: string,
    private readonly defaultMaxTokens: number
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.chat.completions.create(this.createParams(request), {
        signal: request.signal
      })
      return mapResponse(response)
    } catch (error) {
      throw normalizeOpenAIError(error)
    }
  }

  async stream(
    request: LlmRequest,
    onText?: (delta: string) => void
  ): Promise<LlmResponse> {
    try {
      const stream = this.client.chat.completions.stream({
        ...this.createParams(request),
        stream: true
      }, {
        signal: request.signal
      })
      if (onText) stream.on('content', (delta) => onText(delta))
      return mapResponse(await stream.finalChatCompletion())
    } catch (error) {
      throw normalizeOpenAIError(error)
    }
  }

  private createParams(request: LlmRequest): ChatCompletionCreateParamsNonStreaming {
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new OpenAIClientError('config', 'maxTokens 必须是正整数', false)
    }

    return {
      model: request.model ?? this.defaultModel,
      messages: toChatMessages(request),
      max_completion_tokens: maxTokens,
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools.map((tool): ChatCompletionTool => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false
            }
          })) }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.effort !== undefined ? { reasoning_effort: request.effort } : {})
    } as ChatCompletionCreateParamsNonStreaming
  }
}

function toChatMessages(request: LlmRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = request.system !== undefined
    ? [{ role: 'system', content: request.system }]
    : []

  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content })
      continue
    }

    const text = message.content.filter((block) => block.type === 'text')
      .map((block) => block.text).join('\n')
    const toolUses = message.content.filter((block) => block.type === 'tool_use')
    if (toolUses.length > 0) {
      if (message.role !== 'assistant') {
        throw new OpenAIClientError('config', 'tool_use 只能位于 assistant 消息中', false)
      }
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((block) => ({
          type: 'function',
          id: block.id,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        }))
      })
    } else if (text) {
      messages.push({ role: message.role, content: text })
    }

    for (const block of message.content) {
      if (block.type !== 'tool_result') continue
      messages.push({
        role: 'tool',
        tool_call_id: block.toolUseId,
        content: block.content
      })
    }
  }

  return messages
}

function mapResponse(response: ChatCompletion): LlmResponse {
  const choice = response.choices[0]
  if (!choice) {
    throw new OpenAIClientError('api', 'OpenAI Chat Completions 响应缺少 choices', false)
  }
  const content: LlmOutputBlock[] = []
  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }
  for (const toolCall of choice.message.tool_calls ?? []) {
    if (toolCall.type !== 'function') continue
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseArguments(toolCall.function.arguments)
    })
  }

  return {
    id: response.id,
    model: response.model,
    stopReason: choice.finish_reason,
    content,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0
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
