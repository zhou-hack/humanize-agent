import type { AgentEvent } from '../../agent/index.js'
import { resolveBridgeAudience } from '../../bridge/roles.js'
import type { KnowledgeAudience } from '../../knowledge/index.js'
import { isILinkUserAllowed } from './config.js'
import {
  parseILinkMessage,
  textFromILinkMessage,
  type ILinkMessage
} from './types.js'

const MAX_SEEN_MESSAGE_IDS = 2000

export interface ILinkConversationTarget {
  userId: string
  scope: string
  audience: KnowledgeAudience
}

export interface ILinkSession {
  run(options: {
    text: string
    onEvent?: (event: AgentEvent) => void
  }): Promise<{ text: string }>
  startNewConversation(): Promise<void>
  close(): Promise<void>
}

export interface ILinkRouterOptions {
  ownerId: string
  allowedUserIds?: ReadonlySet<string>
  bridgeLeaderIds?: ReadonlySet<string>
  initialProcessedMessageIds?: Iterable<string>
  persistMessage?: (message: ILinkMessage) => Promise<void>
  createSession: (target: ILinkConversationTarget) => Promise<ILinkSession>
  sendText: (target: ILinkConversationTarget, text: string) => Promise<unknown>
  onError?: (error: unknown, target?: ILinkConversationTarget) => void
  onReceive?: (target: ILinkConversationTarget, text: string) => void
  onSend?: (target: ILinkConversationTarget, text: string) => void
  onAgentEvent?: (scope: string, event: AgentEvent) => void
}

export class ILinkRouter {
  private readonly sessions = new Map<string, Promise<ILinkSession>>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly seenMessageIds: Set<string>
  private closing = false

  constructor(private readonly options: ILinkRouterOptions) {
    this.seenMessageIds = new Set(options.initialProcessedMessageIds)
  }

  async handleMessage(value: unknown): Promise<void> {
    if (this.closing) return
    const message = parseILinkMessage(value)
    if (!message || message.message_type !== 1 || !message.context_token.trim()) return
    const text = textFromILinkMessage(message)
    if (!text || !isILinkUserAllowed(
      message.from_user_id,
      this.options.ownerId,
      this.options.allowedUserIds ?? new Set()
    )) return
    if (this.seenMessageIds.has(message.message_id)) return

    await this.options.persistMessage?.(message)
    this.rememberMessageId(message.message_id)

    const target: ILinkConversationTarget = {
      userId: message.from_user_id,
      scope: `private:ilinkbot:${message.from_user_id}`,
      audience: resolveBridgeAudience(
        'ilinkbot',
        message.from_user_id,
        this.options.bridgeLeaderIds ?? new Set()
      )
    }
    this.options.onReceive?.(target, text)
    const previous = this.queues.get(target.scope) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => this.respond(target, text))
    this.queues.set(target.scope, current)
    const cleanup = (): void => {
      if (this.queues.get(target.scope) === current) this.queues.delete(target.scope)
    }
    void current.then(cleanup, cleanup)
  }

  async close(): Promise<void> {
    this.closing = true
    await Promise.all(this.queues.values())
    const sessions = await Promise.allSettled(this.sessions.values())
    for (const result of sessions) {
      if (result.status === 'rejected') continue
      try {
        await result.value.close()
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    this.sessions.clear()
  }

  private async respond(target: ILinkConversationTarget, text: string): Promise<void> {
    let reply: string
    try {
      const session = await this.getSession(target)
      if (text.trim() === '/new') {
        await session.startNewConversation()
        reply = '已开始新对话。'
      } else {
        const result = await session.run({
          text,
          onEvent: event => this.options.onAgentEvent?.(target.scope, event)
        })
        reply = result.text
      }
    } catch (error) {
      this.options.onError?.(error, target)
      reply = '处理这条消息时出错，请稍后再试。'
    }

    if (!reply.trim()) return
    try {
      await this.options.sendText(target, reply)
      this.options.onSend?.(target, reply)
    } catch (error) {
      this.options.onError?.(error, target)
    }
  }

  private getSession(target: ILinkConversationTarget): Promise<ILinkSession> {
    const existing = this.sessions.get(target.scope)
    if (existing) return existing
    const creating = this.options.createSession(target)
    this.sessions.set(target.scope, creating)
    creating.catch(() => {
      if (this.sessions.get(target.scope) === creating) this.sessions.delete(target.scope)
    })
    return creating
  }

  private rememberMessageId(messageId: string): void {
    this.seenMessageIds.delete(messageId)
    this.seenMessageIds.add(messageId)
    while (this.seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageIds.values().next().value
      if (typeof oldest !== 'string') break
      this.seenMessageIds.delete(oldest)
    }
  }
}
