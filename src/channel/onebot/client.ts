import { randomUUID } from 'node:crypto'
import WebSocket, { type RawData } from 'ws'
import { atSegment, textSegment } from './segments.js'
import { isOneBotEvent, isRecord, type OneBotEvent } from './types.js'

export type OneBotConnectionStatus = 'connected' | 'disconnected'

export interface OneBotClientOptions {
  url: string
  accessToken?: string
  onEvent: (event: OneBotEvent) => void | Promise<void>
  onError?: (error: unknown) => void
  onStatus?: (status: OneBotConnectionStatus) => void
  requestTimeoutMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
}

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class OneBotClient {
  private readonly requestTimeoutMs: number
  private readonly reconnectMinMs: number
  private readonly reconnectMaxMs: number
  private readonly pending = new Map<string, PendingRequest>()
  private socket: WebSocket | undefined
  private reconnectTimer: NodeJS.Timeout | undefined
  private reconnectAttempt = 0
  private started = false
  private closing = false

  constructor(private readonly options: OneBotClientOptions) {
    const url = new URL(options.url)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new TypeError('ONEBOT_WS_URL 必须使用 ws 或 wss 协议')
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.reconnectMinMs = options.reconnectMinMs ?? 1_000
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000
    if (this.requestTimeoutMs <= 0 || this.reconnectMinMs <= 0 || this.reconnectMaxMs < this.reconnectMinMs) {
      throw new TypeError('OneBot 超时和重连间隔配置无效')
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.closing = false
    this.connect()
  }

  async close(): Promise<void> {
    this.started = false
    this.closing = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.rejectPending(new Error('OneBot 客户端已关闭'))

    const socket = this.socket
    this.socket = undefined
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        socket.terminate()
        finish()
      }, 1_000)
      timer.unref()
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      socket.once('close', finish)
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      } else {
        socket.close()
      }
    })
  }

  call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OneBot WebSocket 尚未连接'))
    }

    const echo = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        reject(new Error(`OneBot 调用超时: ${action}`))
      }, this.requestTimeoutMs)
      timer.unref()
      this.pending.set(echo, {
        resolve: (data) => resolve(data as T),
        reject,
        timer
      })
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return
        const pending = this.pending.get(echo)
        if (!pending) return
        this.pending.delete(echo)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  sendPrivateMessage(userId: number, text: string): Promise<{ message_id: number }> {
    return this.call('send_private_msg', {
      user_id: userId,
      message: [textSegment(text)]
    })
  }

  sendGroupMessage(groupId: number, userId: number, text: string): Promise<{ message_id: number }> {
    return this.call('send_group_msg', {
      group_id: groupId,
      message: [atSegment(userId), textSegment(`\n${text}`)]
    })
  }

  private connect(): void {
    if (this.closing || this.socket) return
    const socket = new WebSocket(this.options.url, {
      headers: this.options.accessToken
        ? { Authorization: `Bearer ${this.options.accessToken}` }
        : undefined
    })
    this.socket = socket

    socket.on('open', () => {
      if (this.socket !== socket) return
      this.reconnectAttempt = 0
      this.options.onStatus?.('connected')
    })
    socket.on('message', (data) => {
      if (this.socket === socket) this.handleMessage(data)
    })
    socket.on('error', (error) => {
      if (this.socket === socket) this.report(error)
    })
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.rejectPending(new Error('OneBot WebSocket 已断开'))
      this.options.onStatus?.('disconnected')
      this.scheduleReconnect()
    })
  }

  private handleMessage(data: RawData): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawDataToString(data))
    } catch (error) {
      this.report(error)
      return
    }
    if (!isRecord(parsed)) return

    if (typeof parsed.echo === 'string') {
      const pending = this.pending.get(parsed.echo)
      if (pending) {
        this.pending.delete(parsed.echo)
        clearTimeout(pending.timer)
        if (parsed.status === 'ok') {
          pending.resolve(parsed.data)
        } else {
          const retcode = typeof parsed.retcode === 'number' ? ` (${parsed.retcode})` : ''
          const message = typeof parsed.message === 'string' ? parsed.message : '未知错误'
          pending.reject(new Error(`OneBot 调用失败${retcode}: ${message}`))
        }
        return
      }
    }

    if (!isOneBotEvent(parsed)) return
    void Promise.resolve(this.options.onEvent(parsed)).catch((error) => this.report(error))
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** this.reconnectAttempt
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private report(error: unknown): void {
    this.options.onError?.(error)
  }
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}
