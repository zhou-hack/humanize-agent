// 短期记忆：近 7d 的 title + desc 列表，每轮自动注入上下文
// 超过 7d 自动"不再被索引"，数据不动，无需迁移

import type { Conversation } from './store'

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** 查询近 7 天的会话索引 */
export function getRecentConversations(): Promise<Conversation[]> {
  // SELECT id, title, "desc", created_at FROM conversations
  // WHERE created_at > :now - RECENT_WINDOW_MS ORDER BY created_at DESC
  throw new Error('not implemented')
}

/** 渲染成注入 prompt 的文本 */
export function formatRecentIndex(conversations: Conversation[]): string {
  if (conversations.length === 0) return ''
  const lines = conversations.map((c) => {
    const date = new Date(c.created_at).toISOString().slice(0, 10)
    return `- [${date}] ${c.title ?? '(未命名)'}: ${c.desc ?? ''}`
  })
  return `最近 7 天的对话：\n${lines.join('\n')}`
}
