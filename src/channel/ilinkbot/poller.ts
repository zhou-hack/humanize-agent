import {
  ILinkApiError,
  ILinkClient,
  ILinkRequestError,
  responseErrorCode
} from './client.js'
import type { ILinkRouter } from './router.js'
import { assertILinkLoginState, type ILinkStateStore } from './state.js'

export interface ILinkPollerOptions {
  client: ILinkClient
  store: ILinkStateStore
  router: ILinkRouter
  signal: AbortSignal
  onError?: (error: unknown) => void
  onPause?: () => void
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>
}

export class ILinkPoller {
  private readonly sleep: (durationMs: number, signal: AbortSignal) => Promise<void>
  private failures = 0
  private longPollingTimeoutMs = 35_000
  private started = false

  constructor(private readonly options: ILinkPollerOptions) {
    this.sleep = options.sleep ?? sleep
  }

  async run(): Promise<void> {
    if (this.started) return
    this.started = true
    const { client, store, router, signal } = this.options

    while (!signal.aborted) {
      const pausedMs = client.pausedRemainingMs
      if (pausedMs > 0) {
        await this.sleep(pausedMs, signal)
        continue
      }

      try {
        const login = store.snapshot
        assertILinkLoginState(login)
        const response = await client.getUpdates({
          token: login.bot_token,
          baseUrl: login.baseurl,
          cursor: login.get_updates_buf,
          timeoutMs: this.longPollingTimeoutMs + 5000,
          signal
        })
        const code = responseErrorCode(response)
        if (code === -14) {
          client.pause(60 * 60 * 1000)
          this.options.onPause?.()
          await this.sleep(client.pausedRemainingMs, signal)
          continue
        }
        if (code !== 0) throw new ILinkApiError(code)

        this.failures = 0
        if (typeof response.longpolling_timeout_ms === 'number' &&
          Number.isFinite(response.longpolling_timeout_ms) &&
          response.longpolling_timeout_ms > 0) {
          this.longPollingTimeoutMs = Math.min(120_000, Math.max(1000, response.longpolling_timeout_ms))
        }

        for (const message of response.msgs ?? []) {
          await router.handleMessage(message)
          if (signal.aborted) break
        }
        const nextCursor = response.get_updates_buf
        if (typeof nextCursor === 'string' && nextCursor) {
          await store.update(current => {
            current.get_updates_buf = nextCursor
          })
        }
      } catch (error) {
        if (signal.aborted || (error instanceof ILinkRequestError && error.kind === 'abort')) return
        if (error instanceof ILinkRequestError && error.kind === 'timeout') continue
        if (error instanceof ILinkApiError && error.code === -14) {
          client.pause(60 * 60 * 1000)
          this.options.onPause?.()
          await this.sleep(client.pausedRemainingMs, signal)
          continue
        }

        this.failures += 1
        this.options.onError?.(error)
        const delayMs = this.failures >= 3 ? 30_000 : 2000
        if (this.failures >= 3) this.failures = 0
        await this.sleep(delayMs, signal)
      }
    }
  }
}

function sleep(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, durationMs)
    const abort = (): void => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
