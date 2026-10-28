import { ToolError } from '../tools/tool_calling/errors.js'
import type { MemoryStore, StoredMessage } from './store.js'

export const SEARCH_PAGE_SIZE = 10
export const DEFAULT_CONVERSATION_PAGE_SIZE = 50
export const MAX_CONVERSATION_PAGE_SIZE = 100
const SNIPPETS_PER_CONVERSATION = 3
const TOOL_RESULT_MAX_CHARS = 500

export interface MemorySearchItem {
  id: string
  title: string | null
  desc: string | null
  last_message_at: number
  snippets: string[]
}

export interface MemorySearchResult {
  query: string
  page: number
  results: MemorySearchItem[]
  has_more: boolean
}

export interface MemoryListResult {
  before: string
  next_before: string | null
  conversations: Array<{
    id: string
    title: string
    desc: string
    last_message_at: number
  }>
}

export interface ConversationMessagePage {
  id: string
  offset: number
  limit: number
  messages: Array<{
    role: string
    text: string
    created_at: number
  }>
  has_more: boolean
}

export function searchMemory(store: MemoryStore, query: string, page = 0): MemorySearchResult {
  const normalized = query.trim()
  if (!normalized) {
    throw new ToolError('invalid_args', '检索关键词不能为空')
  }
  assertNonNegativeInteger(page, 'page')

  const shortQuery = Array.from(normalized).length < 3
  const match = shortQuery ? null : escapeFtsPhrase(normalized)
  const pattern = shortQuery ? toLikePattern(normalized) : null
  const rows = shortQuery
    ? store.searchByLike(pattern as string, SEARCH_PAGE_SIZE + 1, page * SEARCH_PAGE_SIZE)
    : store.searchByMatch(match as string, SEARCH_PAGE_SIZE + 1, page * SEARCH_PAGE_SIZE)
  const hasMore = rows.length > SEARCH_PAGE_SIZE
  const pageRows = rows.slice(0, SEARCH_PAGE_SIZE)

  return {
    query: normalized,
    page,
    results: pageRows.map((row) => ({
      id: row.id,
      title: row.title,
      desc: row.desc,
      last_message_at: row.lastMessageAt,
      snippets: shortQuery
        ? store.getLikeSnippetTexts(row.id, pattern as string, SNIPPETS_PER_CONVERSATION)
          .map((text) => makeSnippet(text, normalized))
        : store.getMatchSnippets(row.id, match as string, SNIPPETS_PER_CONVERSATION)
    })),
    has_more: hasMore
  }
}

export function listMemory(store: MemoryStore, before?: string, now = Date.now()): MemoryListResult {
  const beforeDate = parseLocalDate(before ?? formatLocalDate(now))
  const fromDate = new Date(beforeDate)
  fromDate.setDate(fromDate.getDate() - 7)
  const conversations = store.listConversationIndexes(fromDate.getTime(), beforeDate.getTime())
  const nextBefore = store.hasConversationIndexBefore(fromDate.getTime())
    ? formatLocalDate(fromDate.getTime())
    : null

  return {
    before: formatLocalDate(beforeDate.getTime()),
    next_before: nextBefore,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      desc: conversation.desc,
      last_message_at: conversation.lastMessageAt
    }))
  }
}

export function getConversationMessages(
  store: MemoryStore,
  id: string,
  offset = 0,
  limit = DEFAULT_CONVERSATION_PAGE_SIZE
): ConversationMessagePage {
  assertNonNegativeInteger(offset, 'offset')
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONVERSATION_PAGE_SIZE) {
    throw new ToolError('invalid_args', `limit 必须是 1 到 ${MAX_CONVERSATION_PAGE_SIZE} 之间的整数`)
  }
  store.getConversation(id)
  const rows = store.listMessages(id, { offset, limit: limit + 1 })

  return {
    id,
    offset,
    limit,
    messages: rows.slice(0, limit).map((message) => ({
      role: message.role,
      text: message.role === 'tool' ? summarizeToolMessage(message) : message.text,
      created_at: message.createdAt
    })),
    has_more: rows.length > limit
  }
}

export function escapeFtsPhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

export function toLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function summarizeToolMessage(message: StoredMessage): string {
  if (typeof message.content !== 'object' || message.content === null) {
    return truncate(message.text || '[工具消息]', TOOL_RESULT_MAX_CHARS)
  }

  const content = message.content as Record<string, unknown>
  const name = typeof content.name === 'string'
    ? content.name
    : typeof content.tool_name === 'string' ? content.tool_name : 'tool'
  const result = 'result' in content ? content.result : content
  let serialized: string
  if (typeof result === 'string') {
    serialized = result
  } else {
    serialized = JSON.stringify(result) ?? ''
  }
  return truncate(`[工具 ${name}] ${serialized}`, TOOL_RESULT_MAX_CHARS)
}

function makeSnippet(text: string, query: string, maxChars = 120): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text

  const lowerText = text.toLocaleLowerCase()
  const index = lowerText.indexOf(query.toLocaleLowerCase())
  const characterIndex = index < 0 ? 0 : Array.from(text.slice(0, index)).length
  const start = Math.max(0, Math.min(characterIndex - 40, characters.length - maxChars))
  const selected = characters.slice(start, start + maxChars).join('')
  return `${start > 0 ? '…' : ''}${selected}${start + maxChars < characters.length ? '…' : ''}`
}

function truncate(text: string, maxChars: number): string {
  const characters = Array.from(text)
  return characters.length <= maxChars ? text : `${characters.slice(0, maxChars).join('')}…`
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ToolError('invalid_args', `${name} 必须是非负整数`)
  }
}

function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new ToolError('invalid_args', 'before 必须使用 YYYY-MM-DD 格式')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ToolError('invalid_args', 'before 不是有效日期')
  }
  date.setHours(0, 0, 0, 0)
  return date
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
