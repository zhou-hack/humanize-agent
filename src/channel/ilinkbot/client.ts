import { getRandomValues, randomUUID } from 'node:crypto'
import { parseILinkJson, type ILinkGetUpdatesResponse } from './types.js'

export const ILINK_API_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const ILINK_CHANNEL_VERSION = '2.4.10'
export const ILINK_MAX_TEXT_LENGTH = 4000

const BOT_AGENT = 'humanize-agent/0.1.0'
const CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10)

type JsonRecord = Record<string, unknown>

export interface ILinkRequestOptions {
  token?: string
  baseUrl?: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface ILinkClientOptions {
  fetchImpl?: typeof fetch
  randomUInt32?: () => number
  now?: () => number
  createClientId?: () => string
}

export class ILinkRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'abort' | 'network' | 'http' | 'protocol'
  ) {
    super(message)
    this.name = 'ILinkRequestError'
  }
}

export class ILinkApiError extends Error {
  constructor(
    readonly code: number,
    message = `ILink API 返回错误（${code}）`,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ILinkApiError'
  }
}

export class ILinkClient {
  private readonly fetchImpl: typeof fetch
  private readonly randomUInt32: () => number
  private readonly now: () => number
  private readonly createClientId: () => string
  private readonly controllers = new Set<AbortController>()
  private pauseUntil = 0
  private closed = false

  constructor(options: ILinkClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.randomUInt32 = options.randomUInt32 ?? randomUInt32
    this.now = options.now ?? Date.now
    this.createClientId = options.createClientId ?? (() => `humanize-agent-${randomUUID()}`)
  }

  get pausedRemainingMs(): number {
    return Math.max(0, this.pauseUntil - this.now())
  }

  pause(durationMs: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, this.now() + durationMs)
  }

  async get(path: string, options: Omit<ILinkRequestOptions, 'token'>): Promise<JsonRecord> {
    return this.request('GET', path, undefined, options)
  }

  async post(path: string, body: JsonRecord, options: ILinkRequestOptions): Promise<JsonRecord> {
    return this.request('POST', path, body, options)
  }

  async getUpdates(options: {
    token: string
    baseUrl?: string
    cursor: string
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<ILinkGetUpdatesResponse> {
    return await this.post('ilink/bot/getupdates', {
      get_updates_buf: options.cursor
    }, {
      token: options.token,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {})
    }) as ILinkGetUpdatesResponse
  }

  async sendText(options: {
    token: string
    baseUrl?: string
    toUserId: string
    getContextToken: () => string
    text: string
    signal?: AbortSignal
  }): Promise<void> {
    const chunks = splitText(options.text, ILINK_MAX_TEXT_LENGTH)
    for (const chunk of chunks) {
      const contextToken = options.getContextToken()
      if (!contextToken) throw new Error('缺少该用户的 context_token，不能主动发送消息')
      const response = await this.post('ilink/bot/sendmessage', {
        msg: {
          from_user_id: '',
          to_user_id: options.toUserId,
          client_id: this.createClientId(),
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text: chunk } }]
        }
      }, {
        token: options.token,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        timeoutMs: 15_000,
        ...(options.signal ? { signal: options.signal } : {})
      })
      const code = responseErrorCode(response)
      if (code !== 0) {
        if (code === -14) this.pause(60 * 60 * 1000)
        throw new ILinkApiError(code)
      }
    }
  }

  close(): void {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: JsonRecord | undefined,
    options: ILinkRequestOptions
  ): Promise<JsonRecord> {
    if (this.closed) throw new ILinkRequestError('ILink 客户端已关闭', 'abort')
    if (options.signal?.aborted) throw new ILinkRequestError('ILink 请求已取消', 'abort')
    if (options.token && this.pausedRemainingMs > 0) {
      throw new ILinkApiError(-14, 'ILink 会话失效，当前处于暂停请求期', this.pausedRemainingMs)
    }

    const controller = new AbortController()
    this.controllers.add(controller)
    let timedOut = false
    const abort = (): void => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)

    try {
      const headers: Record<string, string> = {
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': CLIENT_VERSION
      }
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json'
        headers.AuthorizationType = 'ilink_bot_token'
        headers['X-WECHAT-UIN'] = Buffer.from(String(this.randomUInt32())).toString('base64')
        if (options.token) headers.Authorization = `Bearer ${options.token}`
      }

      const response = await this.fetchImpl(resolveUrl(options.baseUrl, path), {
        method,
        headers,
        ...(method === 'POST' ? {
          body: JSON.stringify({
            ...body,
            base_info: {
              channel_version: ILINK_CHANNEL_VERSION,
              bot_agent: BOT_AGENT
            }
          })
        } : {}),
        signal: controller.signal
      })
      if (!response.ok) throw new ILinkRequestError(`ILink HTTP 状态异常（${response.status}）`, 'http')
      const parsed = parseILinkJson(await response.text())
      if (!isRecord(parsed)) throw new ILinkRequestError('ILink 响应不是 JSON 对象', 'protocol')
      return parsed
    } catch (error) {
      if (error instanceof ILinkRequestError) throw error
      if (timedOut) throw new ILinkRequestError('ILink 请求超时', 'timeout')
      if (controller.signal.aborted) throw new ILinkRequestError('ILink 请求已取消', 'abort')
      throw new ILinkRequestError('ILink 网络请求失败', 'network')
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      this.controllers.delete(controller)
    }
  }
}

export function responseErrorCode(response: JsonRecord): number {
  const errcode = response.errcode
  if (typeof errcode === 'number' && Number.isFinite(errcode) && errcode !== 0) return errcode
  const ret = response.ret
  return typeof ret === 'number' && Number.isFinite(ret) ? ret : 0
}

function resolveUrl(baseUrl: string | undefined, path: string): string {
  const base = new URL(baseUrl ?? ILINK_API_BASE_URL)
  if (base.protocol !== 'https:' || !base.hostname || base.username || base.password || base.search || base.hash) {
    throw new ILinkRequestError('ILink baseurl 必须是无用户名密码的 HTTPS URL', 'protocol')
  }
  return `${base.toString().replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`
}

function splitText(text: string, maxLength: number): string[] {
  const characters = Array.from(text)
  if (characters.length === 0) return []
  const chunks: string[] = []
  for (let index = 0; index < characters.length; index += maxLength) {
    chunks.push(characters.slice(index, index + maxLength).join(''))
  }
  return chunks
}

function randomUInt32(): number {
  const value = new Uint32Array(1)
  getRandomValues(value)
  return value[0] ?? 0
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
