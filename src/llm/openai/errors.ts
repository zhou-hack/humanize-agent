import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from 'openai'

export type OpenAIClientErrorCode =
  | 'config'
  | 'authentication'
  | 'permission'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limit'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'api'

export class OpenAIClientError extends Error {
  constructor(
    readonly code: OpenAIClientErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message)
    this.name = 'OpenAIClientError'
  }
}

export function normalizeOpenAIError(error: unknown): OpenAIClientError {
  if (error instanceof OpenAIClientError) return error
  if (error instanceof APIUserAbortError || (error instanceof Error && error.name === 'AbortError')) {
    return new OpenAIClientError('aborted', 'OpenAI 请求已取消', false)
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAIClientError('timeout', 'OpenAI 请求超时', true)
  }
  if (error instanceof APIConnectionError) {
    return new OpenAIClientError('network', '无法连接 OpenAI 服务', true)
  }
  if (error instanceof APIError) {
    const status = error.status
    if (status === 401) return new OpenAIClientError('authentication', 'OpenAI 身份验证失败', false, status)
    if (status === 403) return new OpenAIClientError('permission', '没有权限调用 OpenAI 服务', false, status)
    if (status === 404) return new OpenAIClientError('not_found', 'OpenAI 模型或接口不存在', false, status)
    if (status === 408) return new OpenAIClientError('timeout', 'OpenAI 请求超时', true, status)
    if (status === 429) return new OpenAIClientError('rate_limit', 'OpenAI 请求频率受限', true, status)
    if (status === 400 || status === 422) {
      return new OpenAIClientError('invalid_request', 'OpenAI 请求参数无效', false, status)
    }
    return new OpenAIClientError(
      'api',
      'OpenAI 服务返回错误',
      status !== undefined && status >= 500,
      status
    )
  }
  return new OpenAIClientError('api', 'OpenAI 请求失败', false)
}
