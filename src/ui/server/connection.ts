import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Anthropic } from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import {
  createAnthropicClient,
  createOpenAIClient,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type OpenAIApiMode
} from '../../llm/index.js'

const DEFAULT_MAX_TOKENS = 4096
const MODEL_LIST_TIMEOUT_MS = 10_000
const MODEL_LIST_LIMIT = 200

export type ConnectionProvider = 'openai' | 'anthropic'
export type ConnectionSource = 'env' | 'saved'

export interface PublicConnection {
  provider: ConnectionProvider
  base_url: string
  model: string
  api_mode: OpenAIApiMode
  max_tokens: number
  temperature: number | null
  has_api_key: boolean
  source: ConnectionSource
}

export interface ConnectionInput {
  provider?: unknown
  api_key?: unknown
  base_url?: unknown
  model?: unknown
  api_mode?: unknown
  max_tokens?: unknown
  temperature?: unknown
}

interface ConnectionConfig {
  provider: ConnectionProvider
  apiKey: string
  baseURL: string
  model: string
  apiMode: OpenAIApiMode
  maxTokens: number
  temperature: number | null
}

export class ConnectionError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'ConnectionError'
  }
}

export class ConnectionManager implements LlmClient {
  private config: ConnectionConfig
  private source: ConnectionSource
  private client: LlmClient | undefined

  constructor(private readonly filePath = join(homedir(), '.humanize-agent', 'connection.json')) {
    const saved = readSavedConnection(filePath)
    this.config = saved ?? readEnvironment()
    this.source = saved ? 'saved' : 'env'
  }

  get model(): string {
    return this.config.model
  }

  getPublicConfig(): PublicConnection {
    return {
      provider: this.config.provider,
      base_url: this.config.baseURL,
      model: this.config.model,
      api_mode: this.config.apiMode,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      has_api_key: this.config.apiKey.length > 0,
      source: this.source
    }
  }

  async save(input: ConnectionInput): Promise<PublicConnection> {
    const candidateConfig = this.parseSaveInput(input)
    let candidateClient: LlmClient
    try {
      candidateClient = buildClient(candidateConfig)
    } catch (error) {
      if (error instanceof ConnectionError) throw error
      throw new ConnectionError(redactError(error, candidateConfig.apiKey))
    }

    await this.writeSaved(candidateConfig)
    this.config = candidateConfig
    this.client = candidateClient
    this.source = 'saved'
    return this.getPublicConfig()
  }

  async listModels(input: ConnectionInput): Promise<string[]> {
    const config = this.parseModelListInput(input)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS)
    try {
      const ids = new Set<string>()
      if (config.provider === 'openai') {
        const client = new OpenAI({
          apiKey: config.apiKey,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
          timeout: MODEL_LIST_TIMEOUT_MS,
          maxRetries: 0
        })
        for await (const model of client.models.list({ signal: controller.signal })) {
          if (model.id) ids.add(model.id)
          if (ids.size >= MODEL_LIST_LIMIT) break
        }
      } else {
        const client = new Anthropic({
          apiKey: config.apiKey,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
          timeout: MODEL_LIST_TIMEOUT_MS,
          maxRetries: 0
        })
        for await (const model of client.models.list(undefined, { signal: controller.signal })) {
          if (model.id) ids.add(model.id)
          if (ids.size >= MODEL_LIST_LIMIT) break
        }
      }
      return [...ids].sort().slice(0, MODEL_LIST_LIMIT)
    } catch (error) {
      throw modelListError(error, config.provider, controller.signal.aborted)
    } finally {
      clearTimeout(timeout)
    }
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const config = this.config
    const client = this.client ??= buildClient(config)
    return client.complete(withDefaultTemperature(request, config))
  }

  async stream(
    request: LlmRequest,
    onText?: (delta: string) => void,
    onThinking?: (delta: string) => void
  ): Promise<LlmResponse> {
    const config = this.config
    const client = this.client ??= buildClient(config)
    return client.stream(withDefaultTemperature(request, config), onText, onThinking)
  }

  private parseSaveInput(input: ConnectionInput): ConnectionConfig {
    const provider = parseProvider(input.provider)
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    if (!model) throw new ConnectionError('model 必须是非空字符串')
    return {
      provider,
      apiKey: this.resolveApiKey(provider, input.api_key),
      baseURL: parseBaseURL(input.base_url),
      model,
      apiMode: parseApiMode(input.api_mode),
      maxTokens: parseMaxTokens(input.max_tokens),
      temperature: parseTemperature(provider, input.temperature)
    }
  }

  private parseModelListInput(input: ConnectionInput): Pick<ConnectionConfig, 'provider' | 'apiKey' | 'baseURL'> {
    const provider = parseProvider(input.provider)
    const apiKey = this.resolveApiKey(provider, input.api_key)
    if (!apiKey) throw new ConnectionError('缺少 API Key，无法获取模型列表')
    return { provider, apiKey, baseURL: parseBaseURL(input.base_url) }
  }

  private resolveApiKey(provider: ConnectionProvider, value: unknown): string {
    if (value !== undefined && typeof value !== 'string') {
      throw new ConnectionError('api_key 必须是字符串')
    }
    const apiKey = (value as string | undefined)?.trim() ?? ''
    if (apiKey) return apiKey
    if (provider === this.config.provider) return this.config.apiKey
    throw new ConnectionError('切换提供商时必须填写新的 API Key')
  }

  private async writeSaved(config: ConnectionConfig): Promise<void> {
    const directory = dirname(this.filePath)
    const temporaryPath = join(directory, `${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`)
    const saved = {
      provider: config.provider,
      api_key: config.apiKey,
      base_url: config.baseURL,
      model: config.model,
      api_mode: config.apiMode,
      max_tokens: config.maxTokens,
      temperature: config.temperature
    }
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}

function readEnvironment(): ConnectionConfig {
  const provider = parseProvider(process.env.LLM_PROVIDER ?? 'anthropic')
  if (provider === 'openai') {
    return {
      provider,
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseURL: process.env.OPENAI_BASE_URL ?? '',
      model: process.env.OPENAI_MODEL ?? '',
      apiMode: parseApiMode(process.env.OPENAI_API_MODE),
      maxTokens: parseMaxTokens(process.env.OPENAI_MAX_TOKENS === undefined
        ? DEFAULT_MAX_TOKENS
        : Number(process.env.OPENAI_MAX_TOKENS)),
      temperature: null
    }
  }
  return {
    provider,
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseURL: process.env.ANTHROPIC_BASE_URL ?? '',
    model: process.env.ANTHROPIC_MODEL ?? '',
    apiMode: 'responses',
    maxTokens: parseMaxTokens(process.env.ANTHROPIC_MAX_TOKENS === undefined
      ? DEFAULT_MAX_TOKENS
      : Number(process.env.ANTHROPIC_MAX_TOKENS)),
    temperature: null
  }
}

function readSavedConnection(filePath: string): ConnectionConfig | undefined {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ConnectionError('无法读取已保存的连接配置')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ConnectionError('已保存的连接配置不是有效 JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConnectionError('已保存的连接配置必须是 JSON 对象')
  }
  const input = value as ConnectionInput
  const provider = parseProvider(input.provider ?? 'anthropic')
  const model = input.model === undefined ? '' : input.model
  const apiKey = input.api_key === undefined ? '' : input.api_key
  if (typeof model !== 'string' || typeof apiKey !== 'string') {
    throw new ConnectionError('已保存的连接配置格式无效')
  }
  return {
    provider,
    apiKey,
    baseURL: parseBaseURL(input.base_url),
    model: model.trim(),
    apiMode: parseApiMode(input.api_mode),
    maxTokens: input.max_tokens === undefined ? DEFAULT_MAX_TOKENS : parseMaxTokens(input.max_tokens),
    temperature: parseTemperature(provider, input.temperature)
  }
}

function buildClient(config: ConnectionConfig): LlmClient {
  parseBaseURL(config.baseURL)
  parseMaxTokens(config.maxTokens)
  parseTemperature(config.provider, config.temperature)
  if (config.provider === 'openai') {
    return createOpenAIClient({
      envPath: false,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model,
      maxTokens: config.maxTokens,
      apiMode: config.apiMode
    })
  }
  return createAnthropicClient({
    envPath: false,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
    maxTokens: config.maxTokens
  })
}

function withDefaultTemperature(request: LlmRequest, config: ConnectionConfig): LlmRequest {
  return request.temperature === undefined && config.temperature !== null
    ? { ...request, temperature: config.temperature }
    : request
}

function parseProvider(value: unknown): ConnectionProvider {
  if (value === 'openai' || value === 'anthropic') return value
  throw new ConnectionError('provider 必须是 openai 或 anthropic')
}

function parseBaseURL(value: unknown): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new ConnectionError('base_url 必须是字符串')
  }
  const baseURL = (value as string | undefined)?.trim() ?? ''
  if (!baseURL) return baseURL
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
  } catch {
    throw new ConnectionError('base_url 必须为空或有效的 http(s) 地址')
  }
  return baseURL
}

function parseApiMode(value: unknown): OpenAIApiMode {
  if (value === undefined || value === 'responses') return 'responses'
  if (value === 'chat_completions') return value
  throw new ConnectionError('api_mode 必须是 responses 或 chat_completions')
}

function parseMaxTokens(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ConnectionError('max_tokens 必须是正整数')
  }
  return value as number
}

function parseTemperature(provider: ConnectionProvider, value: unknown): number | null {
  if (value === undefined || value === null) return null
  const maximum = provider === 'openai' ? 2 : 1
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new ConnectionError(`temperature 必须是 null 或 0 到 ${maximum} 之间的数字`)
  }
  return value
}

function modelListError(error: unknown, provider: ConnectionProvider, timedOut: boolean): ConnectionError {
  const name = provider === 'openai' ? 'OpenAI' : 'Anthropic'
  const errorName = error instanceof Error ? error.name : ''
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  if (timedOut || errorName === 'APIConnectionTimeoutError' || errorName === 'TimeoutError') {
    return new ConnectionError(`${name} 模型列表请求超时`, 504)
  }
  if (status === 401) return new ConnectionError(`${name} 身份验证失败，请检查 API Key`, 502)
  if (status === 403) return new ConnectionError(`没有权限读取 ${name} 模型列表`, 502)
  if (status === 404) return new ConnectionError(`${name} 模型列表接口不存在，请检查接口地址`, 502)
  if (status === 429) return new ConnectionError(`${name} 请求频率受限，请稍后重试`, 502)
  if (errorName === 'APIConnectionError') {
    return new ConnectionError(`无法连接 ${name} 服务，请检查接口地址和网络`, 502)
  }
  if (typeof status === 'number') {
    return new ConnectionError(`${name} 模型列表获取失败（HTTP ${status}）`, 502)
  }
  return new ConnectionError(`${name} 模型列表获取失败，请检查连接配置`, 502)
}

function redactError(error: unknown, apiKey: string): string {
  const message = error instanceof Error && error.message ? error.message : '连接配置无效'
  return apiKey ? message.split(apiKey).join('***') : message
}
