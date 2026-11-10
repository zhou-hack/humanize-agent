const ILINK_BIGINT_FIELDS = /("(?:message_id|msg_id|svr_id)"\s*:\s*)(-?\d+)/g
const ILINK_USER_ID = /^[A-Za-z0-9_@.-]{1,128}$/u

export interface ILinkMessageItem {
  type: number
  text_item?: {
    text?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ILinkMessage {
  message_id: string
  from_user_id: string
  to_user_id: string
  message_type: number
  context_token: string
  item_list: ILinkMessageItem[]
  [key: string]: unknown
}

export interface ILinkGetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  get_updates_buf?: string
  longpolling_timeout_ms?: number
  msgs?: ILinkMessage[]
  [key: string]: unknown
}

export function isILinkUserId(value: unknown): value is string {
  return typeof value === 'string' && ILINK_USER_ID.test(value)
}

export function parseILinkJson(text: string): unknown {
  if (!text.trim()) return {}
  const normalized = text.replace(
    ILINK_BIGINT_FIELDS,
    (_match, prefix: string, id: string) => `${prefix}"${id}"`
  )
  return JSON.parse(normalized) as unknown
}

export function parseILinkMessage(value: unknown): ILinkMessage | null {
  if (!isRecord(value) ||
    typeof value.message_id !== 'string' ||
    !value.message_id.trim() ||
    !isILinkUserId(value.from_user_id) ||
    typeof value.to_user_id !== 'string' ||
    typeof value.message_type !== 'number' ||
    !Number.isFinite(value.message_type) ||
    typeof value.context_token !== 'string' ||
    !Array.isArray(value.item_list) ||
    !value.item_list.every(isILinkMessageItem)
  ) {
    return null
  }
  return value as ILinkMessage
}

export function textFromILinkMessage(message: ILinkMessage): string {
  const parts: string[] = []
  for (const item of message.item_list) {
    if (item.type !== 1) continue
    const text = item.text_item?.text
    if (typeof text !== 'string' || !text.trim()) continue
    parts.push(text.trim())
  }
  return parts.join('\n').trim()
}

function isILinkMessageItem(value: unknown): value is ILinkMessageItem {
  if (!isRecord(value) || typeof value.type !== 'number' || !Number.isFinite(value.type)) {
    return false
  }
  if (value.text_item === undefined) return true
  return isRecord(value.text_item) &&
    (value.text_item.text === undefined || typeof value.text_item.text === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
