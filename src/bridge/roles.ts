import type { KnowledgeAudience } from '../knowledge/index.js'

export type BridgeChannel = 'qq' | 'ilinkbot'

export function parseBridgeRole(value: string | undefined): KnowledgeAudience {
  const role = value?.trim() || 'student'
  if (role !== 'student' && role !== 'leader') {
    throw new Error('BRIDGE_ROLE 仅支持 student 或 leader')
  }
  return role
}

export function parseBridgeLeaderIds(value: string | undefined): ReadonlySet<string> {
  const normalized = value?.trim()
  if (!normalized) return new Set()

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw invalidLeaderIds()
  }
  if (!Array.isArray(parsed)) throw invalidLeaderIds()

  const ids = parsed.map((id) => {
    if (typeof id !== 'string' || !isBridgeActorId(id.trim())) throw invalidLeaderIds()
    return id.trim()
  })
  return new Set(ids)
}

export function resolveBridgeAudience(
  channel: BridgeChannel,
  userId: string | number,
  leaderIds: ReadonlySet<string>
): KnowledgeAudience {
  return leaderIds.has(`${channel}:${String(userId)}`) ? 'leader' : 'student'
}

function isBridgeActorId(value: string): boolean {
  return /^qq:[1-9]\d{0,15}$/u.test(value) ||
    /^ilinkbot:[A-Za-z0-9_@.-]{1,128}$/u.test(value)
}

function invalidLeaderIds(): Error {
  return new Error('BRIDGE_LEADER_IDS 必须是身份字符串 JSON 数组，例如 ["qq:123456","ilinkbot:user@im.wechat"]')
}
