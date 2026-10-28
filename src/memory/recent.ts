// 短期记忆：近 3 天（滚动 72h）的 title + desc 列表，仅新会话第一轮注入
// 超过 3 天自动"不再被索引"，数据不动，无需迁移

import type { Conversation } from './store'

export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** 查询近 3 天已总结的会话索引，排除当前会话 */
export function getRecentConversations(_currentId: string): Promise<Conversation[]> {
  // SELECT id, title, "desc", last_message_at FROM conversations
  // WHERE last_message_at >= :now - RECENT_WINDOW_MS AND title IS NOT NULL AND id != :currentId
  // ORDER BY last_message_at DESC
  throw new Error('not implemented')
}

/** 渲染成注入 prompt 的文本 */
export function formatRecentIndex(conversations: Conversation[]): string {
  if (conversations.length === 0) return ''
  const lines = conversations.map((c) => {
    const date = new Date(c.last_message_at).toISOString().slice(0, 10)
    return `- [${date}] ${c.title ?? '(未命名)'}: ${c.desc ?? ''}`
  })
  return `最近 3 天的对话：\n${lines.join('\n')}`
}
