// 长期记忆：不自动索引，注册成 Agent 工具显式调用
// search_memory / list_memory 定位会话，get_conversation 分页取消息

import type { Conversation, StoredMessage } from './store'

export const SEARCH_PAGE_SIZE = 10
export const LIST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const MESSAGE_PAGE_SIZE = 50

export interface SearchHit {
  conversation: Conversation
  snippets: string[] // 命中消息的少量片段
}

/** 作为单个短语拼进 MATCH，防止 FTS 查询语法注入 */
export function toFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

/** search_memory：全时间段关键词检索 */
export function searchMemory(_query: string, _page = 0): Promise<SearchHit[]> {
  // 查询词 >= 3 字：conversations_fts / messages_fts MATCH toFtsPhrase(query)
  // 查询词 < 3 字：trigram 无法 MATCH，改用 FTS 表 LIKE '%' || :query || '%'
  // 按会话聚合：title/desc 命中优先 > bm25 > last_message_at DESC，每页 SEARCH_PAGE_SIZE
  throw new Error('not implemented')
}

/** list_memory：返回 before 之前 7 天内的会话索引，继续翻页时传入上一页的起始时间 */
export function listMemory(_before: number): Promise<Conversation[]> {
  // SELECT id, title, "desc", last_message_at FROM conversations
  // WHERE last_message_at < :before AND last_message_at >= :before - LIST_WINDOW_MS AND title IS NOT NULL
  // ORDER BY last_message_at DESC
  throw new Error('not implemented')
}

/** get_conversation：分页取回某个会话的消息 */
export function getConversationMessages(
  _conversationId: string,
  _offset = 0,
  _limit = MESSAGE_PAGE_SIZE,
): Promise<StoredMessage[]> {
  // SELECT id, role, text, created_at FROM messages
  // WHERE conversation_id = :id ORDER BY id ASC LIMIT :limit OFFSET :offset
  throw new Error('not implemented')
}
