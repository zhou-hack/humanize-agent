import { resolve } from 'node:path'
import { isILinkUserId } from './types.js'

export const DEFAULT_ILINK_STATE_PATH = resolve(
  process.cwd(),
  'src/data/ilinkbot/state.json'
)

export function resolveILinkStatePath(value?: string): string {
  const normalized = value?.trim()
  return normalized ? resolve(normalized) : DEFAULT_ILINK_STATE_PATH
}

export function parseILinkAllow(value?: string): ReadonlySet<string> {
  const entries = (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  const allowed = new Set<string>()
  for (const entry of entries) {
    if (!isILinkUserId(entry)) throw invalidILinkAllow()
    allowed.add(entry)
  }
  return allowed
}

export function isILinkUserAllowed(
  userId: string,
  ownerId: string | undefined,
  allowSet: ReadonlySet<string>
): boolean {
  if (allowSet.size > 0) return allowSet.has(userId)
  return typeof ownerId === 'string' && ownerId.length > 0 && userId === ownerId
}

function invalidILinkAllow(): Error {
  return new Error('ILINK_ALLOW 必须是逗号分隔的合法用户 ID（1-128 位，仅含 A-Za-z0-9_@.-）')
}
