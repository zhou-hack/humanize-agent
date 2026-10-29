import { performance } from 'node:perf_hooks'
import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolResultBlock,
  LlmToolUseBlock
} from '../llm/types.js'
import type { MemoryService } from '../memory/index.js'
import type { StoredMessage } from '../memory/store.js'
import type { ToolExecutor } from '../tools/tool_calling/executor.js'
import type { ToolRegistry } from '../tools/tool_calling/registry.js'
import type { ToolCall, ToolContext, ToolResult } from '../tools/tool_calling/types.js'

export const DEFAULT_AGENT_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_CONTEXT_CHARS = 100_000
export const MAX_TOOL_ROUNDS = 8

const OLD_TOOL_RESULT_CHARS = 1000
const MIN_CONTENT_CHARS = 64
const TOOL_RESULT_TRUNCATION_MARK = '…[旧工具结果已截断]'
const TEXT_TRUNCATION_MARK = '…[内容已截断]'

export type AgentErrorCode = 'aborted' | 'timeout' | 'tool_round_limit'

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; round: number; call: ToolCall }
  | { type: 'tool_result'; round: number; toolUseId: string; result: ToolResult }

export interface AgentOptions {
  memory: MemoryService
  llm: LlmClient
  registry: ToolRegistry
  executor: ToolExecutor
  system?: string
  timeoutMs?: number
  maxContextChars?: number
}

export interface AgentRunOptions {
  text: string
  imageIds?: string[]
  signal?: AbortSignal
  timeoutMs?: number
  onEvent?: (event: AgentEvent) => void
}

export interface AgentRunResult {
  conversationId: string
  text: string
  response: LlmResponse
  toolRounds: number
  truncated: boolean
}

interface StoredToolResult {
  toolUseId: string
  name: string
  result: ToolResult
}

export class Agent {
  private readonly timeoutMs: number
  private readonly maxContextChars: number
  private conversationId: string | null = null
  private messages: LlmMessage[] = []
  private system: string | undefined
  private runQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: AgentOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS
    this.maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS
    if (!Number.isInteger(this.maxContextChars) || this.maxContextChars < 1000) {
      throw new TypeError('maxContextChars 必须是不小于 1000 的整数')
    }
  }

  run(runOptions: AgentRunOptions): Promise<AgentRunResult> {
    const result = this.runQueue.then(() => this.runInternal(runOptions))
    this.runQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async runInternal(runOptions: AgentRunOptions): Promise<AgentRunResult> {
    const controller = new AbortController()
    const signal = controller.signal
    const onExternalAbort = (): void => {
      controller.abort(new AgentError('aborted', 'Agent 请求已取消'))
    }
    const timeoutMs = runOptions.timeoutMs ?? this.timeoutMs
    let remainingMs = timeoutMs
    let resumedAt = performance.now()
    let approvalDepth = 0
    let timer: NodeJS.Timeout | undefined
    const armTimeout = (): void => {
      if (signal.aborted) return
      timer = setTimeout(() => {
        controller.abort(new AgentError('timeout', 'Agent 请求已超时'))
      }, remainingMs)
    }
    const onApprovalStart = (): void => {
      approvalDepth += 1
      if (approvalDepth !== 1) return
      if (timer) clearTimeout(timer)
      timer = undefined
      remainingMs = Math.max(0, remainingMs - (performance.now() - resumedAt))
    }
    const onApprovalEnd = (): void => {
      if (approvalDepth === 0) return
      approvalDepth -= 1
      if (approvalDepth !== 0 || signal.aborted) return
      resumedAt = performance.now()
      armTimeout()
    }
    armTimeout()

    if (runOptions.signal?.aborted) {
      onExternalAbort()
    } else {
      runOptions.signal?.addEventListener('abort', onExternalAbort, { once: true })
    }

    let pendingToolUses: LlmToolUseBlock[] = []
    let completedToolResults: LlmToolResultBlock[] = []

    try {
      throwIfAborted(signal)
      await this.options.memory.initialize()
      const conversation = await this.options.memory.startConversation()
      throwIfAborted(signal)
      await this.prepareConversation(conversation.id)

      const context: ToolContext = {
        conversationId: conversation.id,
        imageIds: [...(runOptions.imageIds ?? [])],
        untrustedSeen: false,
        onApprovalStart,
        onApprovalEnd
      }

      await this.options.memory.recordMessage({ role: 'user', content: runOptions.text })
      this.messages.push({ role: 'user', content: runOptions.text })

      let toolRounds = 0
      while (true) {
        throwIfAborted(signal)
        const finalizing = toolRounds >= MAX_TOOL_ROUNDS
        const request: LlmRequest = {
          messages: limitContextMessages(this.messages, this.maxContextChars),
          system: finalizing ? withToolRoundLimit(this.system) : this.system,
          tools: finalizing ? undefined : this.options.registry.list(),
          signal
        }
        const response = await this.callLlm(request, runOptions.onEvent, signal)

        await this.options.memory.recordMessage({ role: 'assistant', content: response.content })
        this.messages.push({ role: 'assistant', content: response.content })

        const toolUses = response.content.filter(
          (block): block is LlmToolUseBlock => block.type === 'tool_use'
        )
        pendingToolUses = toolUses
        completedToolResults = []
        if (toolUses.length === 0) {
          return {
            conversationId: conversation.id,
            text: responseText(response),
            response,
            toolRounds,
            truncated: isTruncatedResponse(response)
          }
        }
        if (finalizing) {
          throw new AgentError('tool_round_limit', '模型在工具轮数上限后仍请求调用工具')
        }

        toolRounds += 1
        const calls = toolUses.map((block): ToolCall => ({
          id: block.id,
          name: block.name,
          arguments: block.input
        }))
        for (const call of calls) {
          runOptions.onEvent?.({ type: 'tool_call', round: toolRounds, call })
        }

        throwIfAborted(signal)
        const results = await waitFor(
          this.options.executor.executeBatch(calls, context),
          signal
        )

        for (const [index, call] of calls.entries()) {
          const result = results[index]
          if (!result) {
            throw new Error(`工具执行器缺少结果: ${call.id}`)
          }
          runOptions.onEvent?.({
            type: 'tool_result',
            round: toolRounds,
            toolUseId: call.id,
            result
          })

          const content = JSON.stringify(result)
          const stored: StoredToolResult = { toolUseId: call.id, name: call.name, result }
          await this.options.memory.recordMessage({ role: 'tool', content: stored, text: content })
          pendingToolUses = pendingToolUses.filter((block) => block.id !== call.id)
          completedToolResults.push({
            type: 'tool_result',
            toolUseId: call.id,
            content,
            isError: !result.ok
          })
        }

        this.messages.push({ role: 'user', content: completedToolResults })
        pendingToolUses = []
        completedToolResults = []
      }
    } catch (error) {
      if (pendingToolUses.length > 0 || completedToolResults.length > 0) {
        await this.recordInterruptedToolResults(pendingToolUses, completedToolResults, error, signal)
      }
      if (signal.aborted) {
        throw abortError(signal)
      }
      throw error
    } finally {
      clearTimeout(timer)
      runOptions.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private async recordInterruptedToolResults(
    pendingToolUses: LlmToolUseBlock[],
    completedToolResults: LlmToolResultBlock[],
    error: unknown,
    signal: AbortSignal
  ): Promise<void> {
    const kind = interruptionKind(error, signal)
    const missingBlocks: LlmToolResultBlock[] = []

    for (const toolUse of pendingToolUses) {
      const result = interruptedToolResult(kind)
      const content = JSON.stringify(result)
      const stored: StoredToolResult = { toolUseId: toolUse.id, name: toolUse.name, result }
      await this.options.memory.recordMessage({ role: 'tool', content: stored, text: content })
      missingBlocks.push({
        type: 'tool_result',
        toolUseId: toolUse.id,
        content,
        isError: true
      })
    }

    this.messages.push({
      role: 'user',
      content: [...completedToolResults, ...missingBlocks]
    })
  }

  private async prepareConversation(conversationId: string): Promise<void> {
    if (this.conversationId === conversationId) return

    const storedMessages = this.options.memory.store.listMessages(conversationId)
    const context = await this.options.memory.getInitializationContext(conversationId)
    this.messages = restoreMessages(storedMessages)
    this.system = composeSystem(this.options.system, context.core, context.recent)
    this.conversationId = conversationId
  }

  private async callLlm(
    request: LlmRequest,
    onEvent: AgentRunOptions['onEvent'],
    signal: AbortSignal
  ): Promise<LlmResponse> {
    const pending = onEvent
      ? this.options.llm.stream(request, (text) => onEvent({ type: 'text_delta', text }))
      : this.options.llm.complete(request)
    return waitFor(pending, signal)
  }
}

type InterruptionKind = 'cancelled' | 'timeout' | 'limit' | 'unknown'

function interruptionKind(error: unknown, signal: AbortSignal): InterruptionKind {
  if (error instanceof AgentError && error.code === 'tool_round_limit') return 'limit'
  if (signal.aborted) {
    return abortError(signal).code === 'timeout' ? 'timeout' : 'cancelled'
  }
  return 'unknown'
}

function interruptedToolResultBlock(
  toolUse: LlmToolUseBlock,
  kind: InterruptionKind
): LlmToolResultBlock {
  return {
    type: 'tool_result',
    toolUseId: toolUse.id,
    content: JSON.stringify(interruptedToolResult(kind)),
    isError: true
  }
}

function interruptedToolResult(kind: InterruptionKind): ToolResult {
  if (kind === 'limit') {
    return {
      ok: false,
      error: {
        code: 'limit_exceeded',
        message: '工具轮数已达上限，本次调用未执行',
        retryable: true
      }
    }
  }
  if (kind === 'timeout') {
    return {
      ok: false,
      error: {
        code: 'timeout',
        message: '工具调用因请求超时而中断，结果未知；写入可能已经发生，请先读取确认状态',
        retryable: true
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'internal',
      message: kind === 'cancelled'
        ? '工具调用已取消，结果未知；写入可能已经发生，请先读取确认状态'
        : '上次请求在工具结果返回前中断，结果未知；写入可能已经发生，请先读取确认状态',
      retryable: false
    }
  }
}

function restoreMessages(storedMessages: StoredMessage[]): LlmMessage[] {
  const messages: LlmMessage[] = []
  let toolResults: LlmToolResultBlock[] = []
  let pendingToolUses: LlmToolUseBlock[] = []

  const flushToolResults = (): void => {
    for (const toolUse of pendingToolUses) {
      toolResults.push(interruptedToolResultBlock(toolUse, 'unknown'))
    }
    pendingToolUses = []
    if (toolResults.length === 0) return
    messages.push({ role: 'user', content: toolResults })
    toolResults = []
  }

  for (const message of storedMessages) {
    if (message.role === 'tool') {
      const stored = message.content as StoredToolResult
      toolResults.push({
        type: 'tool_result',
        toolUseId: stored.toolUseId,
        content: JSON.stringify(stored.result),
        isError: !stored.result.ok
      })
      pendingToolUses = pendingToolUses.filter((block) => block.id !== stored.toolUseId)
      continue
    }

    flushToolResults()
    const content = message.content as LlmMessage['content']
    messages.push({ role: message.role, content })
    pendingToolUses = message.role === 'assistant' && Array.isArray(content)
      ? content.filter((block): block is LlmToolUseBlock => block.type === 'tool_use')
      : []
  }
  flushToolResults()
  return messages
}

interface ContextGroup {
  messages: LlmMessage[]
  size: number
}

function limitContextMessages(messages: LlmMessage[], maxChars: number): LlmMessage[] {
  if (contextSize(messages) <= maxChars) return messages

  const limited = messages.map(cloneContextMessage)
  compressToolResults(limited, maxChars, OLD_TOOL_RESULT_CHARS)
  const groups = groupContextMessages(limited)
  const selected: ContextGroup[] = []
  let size = 0

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    let group = groups[index] as ContextGroup
    if (selected.length === 0 && group.size > maxChars) {
      const latest = group.messages.map(cloneContextMessage)
      compressToolResults(latest, maxChars, MIN_CONTENT_CHARS)
      compressText(latest, maxChars)
      group = { messages: latest, size: contextSize(latest) }
    }
    if (selected.length > 0 && size + group.size > maxChars) break
    selected.unshift(group)
    size += group.size
  }

  return selected.flatMap((group) => group.messages)
}

function compressToolResults(messages: LlmMessage[], maxChars: number, minimum: number): void {
  let total = contextSize(messages)
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (total <= maxChars) return
      if (block.type !== 'tool_result' || block.content.length <= minimum) continue
      const before = messageSize(message)
      const target = Math.max(minimum, block.content.length - (total - maxChars))
      block.content = truncateWithMark(block.content, target, TOOL_RESULT_TRUNCATION_MARK)
      total += messageSize(message) - before
    }
  }
}

function compressText(messages: LlmMessage[], maxChars: number): void {
  let total = contextSize(messages)
  for (const message of messages) {
    if (total <= maxChars) return
    if (typeof message.content === 'string') {
      if (message.content.length > MIN_CONTENT_CHARS) {
        const before = messageSize(message)
        const target = Math.max(MIN_CONTENT_CHARS, message.content.length - (total - maxChars))
        message.content = truncateWithMark(message.content, target, TEXT_TRUNCATION_MARK)
        total += messageSize(message) - before
      }
      continue
    }

    for (const block of message.content) {
      if (total <= maxChars) return
      if (block.type !== 'text' || block.text.length <= MIN_CONTENT_CHARS) continue
      const before = messageSize(message)
      const target = Math.max(MIN_CONTENT_CHARS, block.text.length - (total - maxChars))
      block.text = truncateWithMark(block.text, target, TEXT_TRUNCATION_MARK)
      total += messageSize(message) - before
    }
  }
}

function groupContextMessages(messages: LlmMessage[]): ContextGroup[] {
  const groups: ContextGroup[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index] as LlmMessage
    const next = messages[index + 1]
    if (hasToolUse(current) && next && isToolResultMessage(next)) {
      const pair = [current, next]
      groups.push({ messages: pair, size: contextSize(pair) })
      index += 1
    } else {
      groups.push({ messages: [current], size: messageSize(current) })
    }
  }
  return groups
}

function hasToolUse(message: LlmMessage): boolean {
  return message.role === 'assistant' && Array.isArray(message.content) &&
    message.content.some((block) => block.type === 'tool_use')
}

function isToolResultMessage(message: LlmMessage): boolean {
  return message.role === 'user' && Array.isArray(message.content) &&
    message.content.some((block) => block.type === 'tool_result')
}

function cloneContextMessage(message: LlmMessage): LlmMessage {
  return {
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : message.content.map((block) => ({ ...block }))
  }
}

function contextSize(messages: LlmMessage[]): number {
  return JSON.stringify(messages).length
}

function messageSize(message: LlmMessage): number {
  return JSON.stringify(message).length
}

function truncateWithMark(content: string, target: number, mark: string): string {
  return content.slice(0, Math.max(0, target - mark.length)) + mark
}

function composeSystem(base: string | undefined, core: string, recent: string): string | undefined {
  const sections: string[] = []
  if (base?.trim()) sections.push(base.trim())
  if (core.trim()) sections.push(`MEMORY.md 核心记忆：\n${core.trim()}`)
  if (recent.trim()) sections.push(recent.trim())
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

function withToolRoundLimit(system: string | undefined): string {
  const instruction = '工具调用轮数已达上限。请根据已有结果直接回答，不要再调用工具。'
  return system ? `${system}\n\n${instruction}` : instruction
}

function responseText(response: LlmResponse): string {
  return response.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n')
}

function isTruncatedResponse(response: LlmResponse): boolean {
  return response.stopReason === 'max_tokens' ||
    response.stopReason === 'max_output_tokens' ||
    response.stopReason === 'length'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function abortError(signal: AbortSignal): AgentError {
  return signal.reason instanceof AgentError
    ? signal.reason
    : new AgentError('aborted', 'Agent 请求已取消')
}

function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(abortError(signal))
        } else {
          resolve(value)
        }
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(signal.aborted ? abortError(signal) : error)
      }
    )
  })
}
