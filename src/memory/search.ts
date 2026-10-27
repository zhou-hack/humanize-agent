// 长期记忆：不自动索引，注册成 Agent 工具显式调用
// 先扫 title/desc 定位，需要全文再取 messages

import type { Conversation, StoredMessage } from './store'

/** 按关键词检索全部历史会话（含 7d 以外） */
export function searchConversations(_query: string): Promise<Conversation[]> {
  // SELECT id, title, "desc", created_at FROM conversations
  // WHERE title LIKE '%' || :query || '%' OR "desc" LIKE '%' || :query || '%'
  // TODO: 不够用再升级 FTS5 全文索引
  throw new Error('not implemented')
}

/** 取回某个会话的完整消息记录 */
export function getConversationMessages(_conversationId: string): Promise<StoredMessage[]> {
  // SELECT role, content, created_at FROM messages
  // WHERE conversation_id = :id ORDER BY id ASC
  throw new Error('not implemented')
}
