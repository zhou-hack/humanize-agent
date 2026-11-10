import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isILinkUserId } from './types.js'

const MAX_PROCESSED_MESSAGE_IDS = 2000

export interface ILinkState {
  bot_token?: string
  baseurl?: string
  bot_id?: string
  owner_id?: string
  get_updates_buf: string
  context_tokens: Record<string, string>
  processed_message_ids: string[]
}

export interface ILinkLoginState extends ILinkState {
  bot_token: string
  baseurl: string
  bot_id: string
  owner_id: string
}

export class ILinkStateStore {
  readonly path: string
  private current: ILinkState = emptyILinkState()
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { path: string }) {
    this.path = options.path
  }

  get snapshot(): ILinkState {
    return cloneILinkState(this.current)
  }

  load(): Promise<ILinkState> {
    return this.serialize(async () => {
      let content: string
      try {
        content = await readFile(this.path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        this.current = emptyILinkState()
        return cloneILinkState(this.current)
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(content) as unknown
      } catch {
        throw new Error('ILink 状态文件包含损坏的 JSON，未覆盖原文件')
      }
      this.current = normalizeILinkState(parsed)
      return cloneILinkState(this.current)
    })
  }

  update(mutator: (current: ILinkState) => void): Promise<ILinkState> {
    return this.serialize(async () => {
      const draft = cloneILinkState(this.current)
      mutator(draft)
      const next = normalizeILinkState(draft)
      await this.writeAtomic(next)
      this.current = next
      return cloneILinkState(next)
    })
  }

  private async writeAtomic(state: ILinkState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      await rename(temporaryPath, this.path)
      await chmod(this.path, 0o600).catch(() => undefined)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

export function hasLogin(state: ILinkState): state is ILinkLoginState {
  try {
    assertILinkLoginState(state)
    return true
  } catch {
    return false
  }
}

export function assertILinkLoginState(
  state: ILinkState
): asserts state is ILinkLoginState {
  if (typeof state.bot_token !== 'string' || !state.bot_token.trim()) {
    throw new Error('ILink bot_token 必须是非空字符串')
  }
  if (typeof state.bot_id !== 'string' || !state.bot_id.trim()) {
    throw new Error('ILink bot_id 必须是非空字符串')
  }
  if (typeof state.baseurl !== 'string') {
    throw new Error('ILink baseurl 必须是无用户名密码的 HTTPS URL')
  }
  assertILinkBaseUrl(state.baseurl)
  if (!isILinkUserId(state.owner_id)) {
    throw new Error('ILink owner_id 非法')
  }
}

function normalizeILinkState(value: unknown): ILinkState {
  if (!isRecord(value)) throw new Error('ILink 状态必须是 JSON 对象')
  if (typeof value.get_updates_buf !== 'string') {
    throw new Error('ILink get_updates_buf 必须是字符串')
  }

  const contextTokens = createContextTokens()
  if (!isRecord(value.context_tokens)) {
    throw new Error('ILink context_tokens 必须是对象')
  }
  for (const [userId, token] of Object.entries(value.context_tokens)) {
    if (!isILinkUserId(userId) || typeof token !== 'string' || !token.trim()) {
      throw new Error('ILink context_tokens 包含非法用户 ID 或空 token')
    }
    contextTokens[userId] = token
  }

  if (!Array.isArray(value.processed_message_ids) ||
    value.processed_message_ids.some(id => typeof id !== 'string' || !id.trim())
  ) {
    throw new Error('ILink processed_message_ids 必须是非空字符串数组')
  }
  const uniqueIds = new Set<string>()
  for (const id of value.processed_message_ids as string[]) {
    uniqueIds.delete(id)
    uniqueIds.add(id)
  }

  const normalized: ILinkState = {
    get_updates_buf: value.get_updates_buf,
    context_tokens: contextTokens,
    processed_message_ids: [...uniqueIds].slice(-MAX_PROCESSED_MESSAGE_IDS)
  }

  let hasLoginField = false
  if (value.bot_token !== undefined) {
    if (typeof value.bot_token !== 'string') {
      throw new Error('ILink bot_token 必须是非空字符串')
    }
    normalized.bot_token = value.bot_token
    hasLoginField = true
  }
  if (value.baseurl !== undefined) {
    if (typeof value.baseurl !== 'string') throw new Error('ILink baseurl 必须是字符串')
    assertILinkBaseUrl(value.baseurl)
    normalized.baseurl = value.baseurl
    hasLoginField = true
  }
  if (value.bot_id !== undefined) {
    if (typeof value.bot_id !== 'string') {
      throw new Error('ILink bot_id 必须是非空字符串')
    }
    normalized.bot_id = value.bot_id
    hasLoginField = true
  }
  if (value.owner_id !== undefined) {
    if (!isILinkUserId(value.owner_id)) throw new Error('ILink owner_id 非法')
    normalized.owner_id = value.owner_id
    hasLoginField = true
  }
  if (hasLoginField) assertILinkLoginState(normalized)
  return normalized
}

function assertILinkBaseUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('ILink baseurl 必须是无用户名密码的 HTTPS URL')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('ILink baseurl 必须是无用户名密码的 HTTPS URL')
  }
}

function emptyILinkState(): ILinkState {
  return {
    get_updates_buf: '',
    context_tokens: createContextTokens(),
    processed_message_ids: []
  }
}

function cloneILinkState(state: ILinkState): ILinkState {
  const clone: ILinkState = {
    get_updates_buf: state.get_updates_buf,
    context_tokens: createContextTokens(),
    processed_message_ids: [...state.processed_message_ids]
  }
  for (const [userId, token] of Object.entries(state.context_tokens)) {
    clone.context_tokens[userId] = token
  }
  if (state.bot_token !== undefined) clone.bot_token = state.bot_token
  if (state.baseurl !== undefined) clone.baseurl = state.baseurl
  if (state.bot_id !== undefined) clone.bot_id = state.bot_id
  if (state.owner_id !== undefined) clone.owner_id = state.owner_id
  return clone
}

function createContextTokens(): Record<string, string> {
  return Object.create(null) as Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
