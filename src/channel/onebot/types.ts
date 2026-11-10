import type { KnowledgeAudience } from '../../knowledge/index.js'

export interface OneBotMessageSegment {
  type: string
  data?: Record<string, unknown>
}

export interface OneBotEvent {
  post_type: string
  [key: string]: unknown
}

export interface OneBotPrivateMessageEvent extends OneBotEvent {
  post_type: 'message'
  message_type: 'private'
  user_id: number
  message: OneBotMessageSegment[]
}

export interface OneBotGroupMessageEvent extends OneBotEvent {
  post_type: 'message'
  message_type: 'group'
  self_id: number
  group_id: number
  user_id: number
  message: OneBotMessageSegment[]
}

export interface OneBotConversationTarget {
  kind: 'private' | 'group'
  id: number
  userId: number
  scope: string
  audience: KnowledgeAudience
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isOneBotEvent(value: unknown): value is OneBotEvent {
  return isRecord(value) && typeof value.post_type === 'string'
}

export function isOneBotPrivateMessageEvent(
  value: OneBotEvent
): value is OneBotPrivateMessageEvent {
  return value.post_type === 'message' &&
    value.message_type === 'private' &&
    isPositiveId(value.user_id) &&
    Array.isArray(value.message) &&
    value.message.every(isMessageSegment)
}

export function isOneBotGroupMessageEvent(
  value: OneBotEvent
): value is OneBotGroupMessageEvent {
  return value.post_type === 'message' &&
    value.message_type === 'group' &&
    isPositiveId(value.self_id) &&
    isPositiveId(value.group_id) &&
    isPositiveId(value.user_id) &&
    Array.isArray(value.message) &&
    value.message.every(isMessageSegment)
}

export function isOneBotBotMentioned(event: OneBotGroupMessageEvent): boolean {
  if (event.user_id === event.self_id) return false
  return event.message.some((segment) =>
    segment.type === 'at' && String(segment.data?.qq) === String(event.self_id)
  )
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isMessageSegment(value: unknown): value is OneBotMessageSegment {
  return isRecord(value) &&
    typeof value.type === 'string' &&
    (value.data === undefined || isRecord(value.data))
}
