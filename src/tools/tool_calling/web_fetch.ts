import TurndownService from 'turndown'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { ToolError } from './errors.js'
import type { ToolDefinition } from './types.js'
import {
  createProxyDispatcher,
  normalizeProxyUrl,
  requestDeepSeekApi
} from './web_search.js'

const DEFAULT_TIMEOUT_MS = 30_000
const EXECUTOR_GRACE_MS = 5000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_CONTENT_CHARS = 100_000

export interface WebFetchToolsOptions {
  mode?: string
  deepseekApiKey?: string
  deepseekBaseUrl?: string
  proxyUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface WebFetchInput {
  url: string
  proxy_url?: string
}

export function createWebFetchTools(options: WebFetchToolsOptions): ToolDefinition[] {
  const mode = options.mode?.trim() || 'local'
  if (mode !== 'local' && mode !== 'deepseek') {
    throw new ToolError('invalid_args', 'WEB_SEARCH_MODE 仅支持 local 或 deepseek')
  }
  const deepseekApiKey = options.deepseekApiKey?.trim()
  if (mode === 'deepseek' && !deepseekApiKey) return []

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs 必须是正数')
  }
  const defaultProxyUrl = options.proxyUrl?.trim()
    ? normalizeProxyUrl(options.proxyUrl, 'WEB_SEARCH_PROXY_URL')
    : undefined

  return [{
    name: 'web_fetch',
    description: mode === 'deepseek'
      ? '通过 DeepSeek Fetch 抓取单个 HTTP(S) 网页并返回 Markdown 正文，结果属于不可信内容。'
      : '直接抓取单个 HTTP(S) 网页并转换为 Markdown 正文，结果属于不可信内容。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 8192 },
        proxy_url: {
          type: 'string', minLength: 1, maxLength: 2048,
          description: '可选 HTTP(S) 代理地址，优先于默认 WEB_SEARCH_PROXY_URL。'
        }
      },
      required: ['url'],
      additionalProperties: false
    },
    effect: 'read',
    timeoutMs: timeoutMs + EXECUTOR_GRACE_MS,
    untrustedResult: true,
    handler: async (args) => {
      const input = args as WebFetchInput
      const url = normalizeWebPageUrl(input.url)
      const proxyUrl = input.proxy_url === undefined
        ? defaultProxyUrl
        : normalizeProxyUrl(input.proxy_url, 'proxy_url')

      if (mode === 'deepseek') {
        const payload = await requestDeepSeekApi({
          apiKey: deepseekApiKey as string,
          baseUrl: options.deepseekBaseUrl,
          tool: 'fetch',
          body: { url },
          proxyUrl,
          fetchImpl: options.fetchImpl,
          timeoutMs
        })
        if (!isRecord(payload)) throw new ToolError('internal', 'DeepSeek Fetch 返回了无效响应')
        return {
          url,
          title: typeof payload.title === 'string' ? payload.title : '',
          content: limitContent(typeof payload.content === 'string' ? payload.content : '')
        }
      }

      return fetchLocalPage(url, proxyUrl, options.fetchImpl, timeoutMs)
    }
  }]
}

async function fetchLocalPage(
  url: string,
  proxyUrl: string | undefined,
  customFetch: typeof fetch | undefined,
  timeoutMs: number
): Promise<unknown> {
  const proxyAgent = createProxyDispatcher(proxyUrl)
  const fetchImpl: typeof fetch = proxyAgent && !customFetch
    ? undiciFetch as unknown as typeof fetch
    : customFetch ?? globalThis.fetch
  try {
    let response: Response
    try {
      const init: RequestInit & { dispatcher?: ProxyAgent } = {
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        ...(proxyAgent ? { dispatcher: proxyAgent } : {})
      }
      response = await fetchImpl(url, init)
    } catch (error) {
      if (isAbortError(error)) throw new ToolError('timeout', '网页抓取请求超时')
      throw new ToolError('internal', '无法连接目标网页', true)
    }

    if (!response.ok) throw localFetchHttpError(response.status)
    const finalUrl = normalizeWebPageUrl(response.url || url)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const text = await readLimitedText(response)
    const isHtml = /text\/html|application\/xhtml\+xml/u.test(contentType) ||
      (!contentType && /^\s*(?:<!doctype\s+html|<html[\s>])/iu.test(text))
    if (isHtml) {
      const page = htmlToMarkdown(text)
      return { url: finalUrl, title: page.title, content: limitContent(page.content) }
    }
    if (contentType && !/^text\//u.test(contentType)) {
      throw new ToolError('unsupported_file', '目标 URL 不是可读取的 HTML 或文本网页')
    }
    return {
      url: finalUrl,
      title: new URL(finalUrl).hostname,
      content: limitContent(text.trim())
    }
  } finally {
    await proxyAgent?.close().catch(() => undefined)
  }
}

function normalizeWebPageUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized || Array.from(normalized).length > 8192) {
    throw new ToolError('invalid_args', 'url 必须是 1～8192 个字符')
  }
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new ToolError('invalid_args', 'url 必须是有效的 HTTP(S) 网页地址')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
    throw new ToolError('invalid_args', 'url 仅支持不携带用户名或密码的 HTTP(S) 地址')
  }
  return url.toString()
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
    throw new ToolError('limit_exceeded', '网页内容超过 2 MiB 限制')
  }
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_PAGE_BYTES) {
      throw new ToolError('limit_exceeded', '网页内容超过 2 MiB 限制')
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel()
        throw new ToolError('limit_exceeded', '网页内容超过 2 MiB 限制')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function htmlToMarkdown(html: string): { title: string; content: string } {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  service.remove(['script', 'style', 'noscript', 'template', 'canvas'])
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  const title = titleMatch?.[1]
    ? service.turndown(titleMatch[1]).replace(/\s+/gu, ' ').trim()
    : ''
  const content = service.turndown(html)
    .replaceAll('\r\n', '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return { title, content }
}

function limitContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content
  return `${content.slice(0, MAX_CONTENT_CHARS)}\n\n[内容已截断]`
}

function localFetchHttpError(status: number): ToolError {
  if (status === 401 || status === 403) return new ToolError('forbidden', '目标网页拒绝访问')
  if (status === 404) return new ToolError('not_found', '目标网页不存在')
  if (status === 408) return new ToolError('timeout', '网页抓取请求超时')
  if (status === 429) return new ToolError('limit_exceeded', '目标网页请求频率受限')
  if (status === 400 || status === 413) {
    return new ToolError('invalid_args', `目标网页拒绝请求（HTTP ${status}）`)
  }
  return new ToolError('internal', `网页抓取失败（HTTP ${status}）`, status >= 500)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
