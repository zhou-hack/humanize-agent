import type { Conversation, MemoryStore, MessageRole } from './store.js'

export const DEFAULT_IDLE_SUMMARY_MS = 60 * 60 * 1000

export interface SummaryMessage {
  role: MessageRole
  text: string
}

export interface SummaryRequest {
  title: string | null
  desc: string | null
  messages: SummaryMessage[]
}

export interface SummaryResult {
  title: string
  desc: string
}

export type ConversationSummarizer = (request: SummaryRequest) => Promise<SummaryResult>

export interface SummarySchedulerOptions {
  idleMs?: number
  now?: () => number
  onError?: (error: unknown, conversationId: string) => void
}

export class MemorySummaryScheduler {
  private readonly idleMs: number
  private readonly now: () => number
  private readonly onError: (error: unknown, conversationId: string) => void
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly running = new Map<string, Promise<void>>()

  constructor(
    private readonly store: MemoryStore,
    private readonly summarize: ConversationSummarizer,
    options: SummarySchedulerOptions = {}
  ) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_SUMMARY_MS
    this.now = options.now ?? Date.now
    this.onError = options.onError ?? (() => undefined)
  }

  async recover(): Promise<void> {
    for (const conversation of this.store.listPendingSummaryConversations()) {
      try {
        await this.summarizeNow(conversation.id)
      } catch (error) {
        this.onError(error, conversation.id)
      }
    }

    for (const conversation of this.store.listActiveConversations()) {
      this.scheduleFromLastMessage(conversation)
    }
  }

  notifyMessage(conversationId: string): void {
    this.schedule(conversationId, this.idleMs)
  }

  async summarizeNow(conversationId: string): Promise<void> {
    const running = this.running.get(conversationId)
    if (running) return running

    const task = this.performSummary(conversationId)
    this.running.set(conversationId, task)
    try {
      await task
    } finally {
      if (this.running.get(conversationId) === task) {
        this.running.delete(conversationId)
      }
    }
  }

  async closeConversation(conversationId: string): Promise<void> {
    this.cancel(conversationId)
    try {
      await this.summarizeNow(conversationId)
    } catch (error) {
      this.onError(error, conversationId)
    } finally {
      this.store.closeConversation(conversationId)
    }
  }

  cancel(conversationId: string): void {
    const timer = this.timers.get(conversationId)
    if (timer) clearTimeout(timer)
    this.timers.delete(conversationId)
  }

  async close(): Promise<void> {
    for (const conversationId of this.timers.keys()) {
      this.cancel(conversationId)
    }
    await Promise.all([...this.running.values()])
  }

  private async performSummary(conversationId: string): Promise<void> {
    const conversation = this.store.getConversation(conversationId)
    const targetMsgId = this.store.getLatestMessageId(conversationId)
    const summarizedMsgId = conversation.summarizedMsgId ?? 0
    if (targetMsgId === null || targetMsgId <= summarizedMsgId) return

    const messages = this.store.listMessages(conversationId, {
      afterId: summarizedMsgId,
      throughId: targetMsgId
    })
    const result = await this.summarize({
      title: conversation.title,
      desc: conversation.desc,
      messages: messages.map((message) => ({ role: message.role, text: message.text }))
    })
    const title = result.title.trim()
    const desc = result.desc.trim()
    if (!title || !desc) {
      throw new Error('会话总结必须包含非空 title 和 desc')
    }

    this.store.updateSummary(conversationId, title, desc, targetMsgId, this.now())
  }

  private scheduleFromLastMessage(conversation: Conversation): void {
    const elapsed = this.now() - conversation.lastMessageAt
    this.schedule(conversation.id, Math.max(0, this.idleMs - elapsed))
  }

  private schedule(conversationId: string, delay: number): void {
    this.cancel(conversationId)
    const timer = setTimeout(() => {
      this.timers.delete(conversationId)
      void this.summarizeNow(conversationId).catch((error: unknown) => {
        this.onError(error, conversationId)
      })
    }, delay)
    timer.unref()
    this.timers.set(conversationId, timer)
  }
}
