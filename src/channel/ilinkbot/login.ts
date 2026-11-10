import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import QRCode from 'qrcode'
import {
  ILINK_API_BASE_URL,
  ILinkClient,
  ILinkRequestError,
  type ILinkRequestOptions
} from './client.js'
import {
  assertILinkLoginState,
  type ILinkLoginState,
  type ILinkStateStore
} from './state.js'

export interface ILinkLoginOptions {
  client: ILinkClient
  store: ILinkStateStore
  qrcodePath?: string
  signal?: AbortSignal
  write?: (text: string) => void
  promptVerifyCode?: (signal?: AbortSignal) => Promise<string>
  showQrCode?: (content: string, path: string) => Promise<string>
  maxRefreshes?: number
}

export async function loginILink(options: ILinkLoginOptions): Promise<ILinkLoginState> {
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const showQrCode = options.showQrCode ?? showILinkQrCode
  const promptVerifyCode = options.promptVerifyCode ?? promptForVerifyCode
  const qrcodePath = options.qrcodePath ?? resolve('ilink_qrcode.png')
  const maxRefreshes = options.maxRefreshes ?? 3
  let baseUrl = ILINK_API_BASE_URL

  for (let refresh = 0; refresh < maxRefreshes; refresh += 1) {
    throwIfAborted(options.signal)
    const qr = await options.client.post('ilink/bot/get_bot_qrcode?bot_type=3', {
      local_token_list: []
    }, requestOptions(15_000, options.signal))
    if (typeof qr.qrcode !== 'string' || !qr.qrcode ||
      typeof qr.qrcode_img_content !== 'string' || !qr.qrcode_img_content) {
      throw new Error('ILink 二维码响应缺少必要字段')
    }

    const terminalQr = await showQrCode(qr.qrcode_img_content, qrcodePath)
    write(`[qrcode] 请使用微信扫码并确认登录。\n${terminalQr}\n[qrcode] 二维码已保存到 ${qrcodePath}\n`)

    let verifyCode = ''
    let previousStatus = ''
    while (true) {
      throwIfAborted(options.signal)
      const query = new URLSearchParams({ qrcode: qr.qrcode })
      if (verifyCode) query.set('verify_code', verifyCode)
      let status: Record<string, unknown>
      try {
        status = await options.client.get(`ilink/bot/get_qrcode_status?${query.toString()}`, {
          baseUrl,
          ...requestOptions(35_000, options.signal)
        })
      } catch (error) {
        if (error instanceof ILinkRequestError && error.kind === 'abort') throw error
        write('[qrcode] 状态查询失败，正在重试。\n')
        await wait(1000, options.signal)
        continue
      }

      const currentStatus = typeof status.status === 'string' ? status.status : 'wait'
      if (currentStatus !== previousStatus) {
        if (currentStatus === 'scaned') write('[qrcode] 已扫码，请在手机上确认。\n')
        previousStatus = currentStatus
      }

      if (currentStatus === 'confirmed') {
        const state = await options.store.update(current => {
          current.bot_token = requiredString(status.bot_token, 'bot_token')
          current.bot_id = requiredString(status.ilink_bot_id, 'ilink_bot_id')
          current.baseurl = typeof status.baseurl === 'string' && status.baseurl
            ? status.baseurl
            : ILINK_API_BASE_URL
          current.owner_id = requiredString(status.ilink_user_id, 'ilink_user_id')
        })
        assertILinkLoginState(state)
        return state
      }

      if (currentStatus === 'need_verifycode') {
        verifyCode = (await promptVerifyCode(options.signal)).trim()
        if (!/^\d+$/u.test(verifyCode)) throw new Error('ILink 验证码必须是数字')
        continue
      }
      if (currentStatus === 'scaned_but_redirect') {
        baseUrl = parseRedirectBaseUrl(status.redirect_host)
      } else if (currentStatus === 'expired' || currentStatus === 'verify_code_blocked') {
        write('[qrcode] 二维码已失效，正在重新获取。\n')
        break
      } else if (currentStatus === 'binded_redirect') {
        throw new Error('该 iLink Bot 已绑定，请使用原有 token 状态文件')
      }
      await wait(1000, options.signal)
    }
  }
  throw new Error('ILink 二维码多次失效，登录失败')
}

export async function showILinkQrCode(content: string, path: string): Promise<string> {
  const [terminal] = await Promise.all([
    QRCode.toString(content, { type: 'terminal', small: true }),
    QRCode.toFile(path, content, { type: 'png' })
  ])
  return terminal
}

function parseRedirectBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ILink 重定向地址无效')
  let url: URL
  try {
    url = new URL(`https://${value.trim()}`)
  } catch {
    throw new Error('ILink 重定向地址无效')
  }
  if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ILink 重定向地址无效')
  }
  return url.origin
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`ILink 登录响应缺少 ${field}`)
  return value
}

function requestOptions(timeoutMs: number, signal?: AbortSignal): Omit<ILinkRequestOptions, 'token'> {
  return { timeoutMs, ...(signal ? { signal } : {}) }
}

async function promptForVerifyCode(signal?: AbortSignal): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await readline.question('请输入手机微信显示的数字验证码：', {
      ...(signal ? { signal } : {})
    })
  } finally {
    readline.close()
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ILinkRequestError('ILink 登录已取消', 'abort')
}

function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ILinkRequestError('ILink 登录已取消', 'abort'))
      return
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, durationMs)
    const abort = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      reject(new ILinkRequestError('ILink 登录已取消', 'abort'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
