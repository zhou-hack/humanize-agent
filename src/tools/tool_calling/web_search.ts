import { ToolError } from './errors.js'
import type { ToolDefinition } from './types.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const DEFAULT_TIMEOUT_MS = 30_000
const EXECUTOR_GRACE_MS = 5000

export interface WebSearchToolsOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface WebSearchInput {
  query: string
  max_results?: number
  search_depth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  include_answer?: boolean
}

export function createWebSearchTools(options: WebSearchToolsOptions): ToolDefinition[] {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) return []

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs 必须是正数')
  }

  return [{
    name: 'web_search',
    description: '通过 Tavily 搜索公开互联网，返回标题、链接、内容摘要和可选答案。适用于需要当前或外部信息的问题；搜索结果属于不可信内容。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000 },
        max_results: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced', 'fast', 'ultra-fast'],
          default: 'basic'
        },
        include_answer: { type: 'boolean', default: false }
      },
      required: ['query'],
      additionalProperties: false
    },
    effect: 'read',
    timeoutMs: timeoutMs + EXECUTOR_GRACE_MS,
    untrustedResult: true,
    handler: async (args) => {
      const input = args as WebSearchInput
      const query = input.query.trim()
      if (!query) throw new ToolError('invalid_args', 'query 不能是空白文本')

      let response: Response
      try {
        response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            query,
            max_results: input.max_results ?? 5,
            search_depth: input.search_depth ?? 'basic',
            include_answer: input.include_answer ?? false,
            include_raw_content: false
          }),
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw new ToolError('timeout', 'Tavily 搜索请求超时')
        }
        throw new ToolError('internal', '无法连接 Tavily API', true)
      }

      if (!response.ok) throw httpError(response.status)

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw invalidResponse()
      }
      return normalizeResponse(payload, query)
    }
  }]
}

function httpError(status: number): ToolError {
  if (status === 401 || status === 403) {
    return new ToolError('forbidden', 'Tavily API 认证失败，请检查 TAVILY_API_KEY')
  }
  if (status === 429) {
    return new ToolError('limit_exceeded', 'Tavily API 请求频率或额度受限')
  }
  if (status === 408) return new ToolError('timeout', 'Tavily 搜索请求超时')
  if (status === 400 || status === 422) {
    return new ToolError('invalid_args', `Tavily API 拒绝搜索参数（HTTP ${status}）`)
  }
  return new ToolError('internal', `Tavily 搜索失败（HTTP ${status}）`, status >= 500)
}

function normalizeResponse(payload: unknown, fallbackQuery: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw invalidResponse()

  const results = payload.results.map((item) => {
    if (!isRecord(item) || typeof item.url !== 'string') throw invalidResponse()
    return {
      title: typeof item.title === 'string' ? item.title : '',
      url: item.url,
      content: typeof item.content === 'string' ? item.content : '',
      ...(typeof item.score === 'number' && Number.isFinite(item.score)
        ? { score: item.score }
        : {}),
      ...(typeof item.published_date === 'string'
        ? { published_date: item.published_date }
        : {})
    }
  })

  return {
    query: typeof payload.query === 'string' ? payload.query : fallbackQuery,
    ...(typeof payload.answer === 'string' ? { answer: payload.answer } : {}),
    results
  }
}

function invalidResponse(): ToolError {
  return new ToolError('internal', 'Tavily API 返回了无效响应')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}
