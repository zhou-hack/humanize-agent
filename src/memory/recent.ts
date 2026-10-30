import type { ConversationIndex, MemoryStore } from './store.js'
import { renderPrompt } from '../prompt/loader.js'

export const RECENT_WINDOW_MS = 72 * 60 * 60 * 1000

export interface RecentMemoryOptions {
  now?: number
  currentConversationId?: string
}

export function getRecentConversations(
  store: MemoryStore,
  options: RecentMemoryOptions = {}
): ConversationIndex[] {
  const now = options.now ?? Date.now()
  return store.listRecentConversations(now - RECENT_WINDOW_MS, options.currentConversationId)
}

export function formatRecentConversationIndex(conversations: ConversationIndex[]): string {
  if (conversations.length === 0) return ''
  const lines = conversations.map((conversation) =>
    `- [${formatLocalDate(conversation.lastMessageAt)}] ${conversation.title}: ${conversation.desc} (id: ${conversation.id})`
  )
  return renderPrompt('init/memory-recent', { entries: lines.join('\n') })
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
