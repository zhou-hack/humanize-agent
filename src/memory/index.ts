import { CoreMemory } from './core.js'
import { formatRecentConversationIndex, getRecentConversations } from './recent.js'
import { MemoryStore, type AppendMessageInput, type Conversation, type StoredMessage } from './store.js'
import {
  MemorySummaryScheduler,
  type ConversationSummarizer,
  type SummarySchedulerOptions
} from './summarize.js'

export const CONVERSATION_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface MemoryServiceOptions {
  store?: MemoryStore
  core?: CoreMemory
  summarize: ConversationSummarizer
  idleSummaryMs?: number
  now?: () => number
  onSummaryError?: SummarySchedulerOptions['onError']
}

export interface MemoryInitializationContext {
  core: string
  recent: string
}

export class MemoryService {
  readonly store: MemoryStore
  readonly core: CoreMemory
  readonly summaries: MemorySummaryScheduler
  private readonly now: () => number
  private currentId: string | null = null
  private initialized = false
  private sessionQueue: Promise<void> = Promise.resolve()

  constructor(options: MemoryServiceOptions) {
    this.store = options.store ?? new MemoryStore()
    this.core = options.core ?? new CoreMemory()
    this.now = options.now ?? Date.now
    this.summaries = new MemorySummaryScheduler(this.store, options.summarize, {
      idleMs: options.idleSummaryMs,
      now: this.now,
      onError: options.onSummaryError
    })
  }

  get currentConversationId(): string | null {
    return this.currentId
  }

  async initialize(): Promise<void> {
    return this.serializeSession(async () => {
      if (this.initialized) return
      await this.core.initialize()
      await this.summaries.recover()
      const active = this.store.getLatestActiveConversation()
      if (active && this.now() - active.createdAt < CONVERSATION_LIFETIME_MS) {
        this.currentId = active.id
      }
      this.initialized = true
    })
  }

  async startConversation(): Promise<Conversation> {
    return this.serializeSession(() => this.startConversationInternal())
  }

  async recordMessage(
    input: Omit<AppendMessageInput, 'conversationId' | 'createdAt'> & { createdAt?: number }
  ): Promise<{ conversation: Conversation; message: StoredMessage }> {
    return this.serializeSession(async () => {
      const conversation = await this.startConversationInternal()
      const message = this.store.appendMessage({
        ...input,
        conversationId: conversation.id,
        createdAt: input.createdAt ?? this.now()
      })
      this.summaries.notifyMessage(conversation.id)
      return { conversation: this.store.getConversation(conversation.id), message }
    })
  }

  async getInitializationContext(conversationId?: string): Promise<MemoryInitializationContext> {
    const [core, recent] = await Promise.all([
      this.core.read(),
      Promise.resolve(getRecentConversations(this.store, {
        now: this.now(),
        currentConversationId: conversationId ?? this.currentId ?? undefined
      }))
    ])
    return {
      core: core.content,
      recent: formatRecentConversationIndex(recent)
    }
  }

  async close(): Promise<void> {
    try {
      await this.summaries.close()
    } finally {
      this.store.close()
    }
  }

  private async startConversationInternal(): Promise<Conversation> {
    if (!this.initialized) {
      await this.core.initialize()
      await this.summaries.recover()
      this.initialized = true
    }

    const current = this.currentId ? this.store.findConversation(this.currentId) : null
    const active = current?.status === 'active' ? current : this.store.getLatestActiveConversation()
    if (active) {
      if (this.now() - active.createdAt < CONVERSATION_LIFETIME_MS) {
        this.currentId = active.id
        return active
      }
      await this.summaries.closeConversation(active.id)
    }

    const conversation = this.store.createConversation(this.now())
    this.currentId = conversation.id
    return conversation
  }

  private serializeSession<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sessionQueue.then(operation, operation)
    this.sessionQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

export * from './core.js'
export * from './media.js'
export * from './recent.js'
export * from './search.js'
export * from './store.js'
export * from './summarize.js'
export * from './tools.js'
