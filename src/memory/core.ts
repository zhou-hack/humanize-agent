import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ToolError } from '../tools/tool_calling/errors.js'

export const DEFAULT_CORE_MEMORY_PATH = resolve(process.cwd(), 'src/data/memory/MEMORY.md')
export const DEFAULT_MAX_CORE_TOKENS = 30_000

const COUNTER_PATTERN = /^\s*<!--\s*memory-next-id:\s*([1-9]\d*)\s*-->\s*$/
const ENTRY_PATTERN = /^- \[(m[1-9]\d*)\](?:\[已纠正 (\d{4}-\d{2}-\d{2}) → (m[1-9]\d*)\])? (.*)$/
const ID_PATTERN = /^m[1-9]\d*$/
const SENSITIVE_PATTERNS = [
  /-----BEGIN [^-]*PRIVATE KEY-----/,
  /\b(?:api[ _-]?key|access[ _-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*\S+/i,
  /(?:密码|密钥|私钥|访问令牌)\s*[:：=]\s*\S+/,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/
]

export interface CoreMemoryEntry {
  id: string
  content: string
  correctedAt?: string
  replacedBy?: string
}

export interface CoreMemorySnapshot {
  content: string
  entries: CoreMemoryEntry[]
  tokens: number
}

export interface CoreMemoryWriteResult {
  id: string
  tokens: number
}

export interface CoreMemoryOptions {
  path?: string
  maxTokens?: number
  tokenCounter?: (content: string) => number | Promise<number>
  now?: () => number
}

interface ParsedMemory {
  content: string
  lines: string[]
  entries: Array<CoreMemoryEntry & { lineIndex: number }>
  nextId: number
}

export class CoreMemory {
  readonly path: string
  private readonly maxTokens: number
  private readonly tokenCounter: (content: string) => number | Promise<number>
  private readonly now: () => number
  private queue: Promise<void> = Promise.resolve()

  constructor(options: CoreMemoryOptions = {}) {
    this.path = options.path ?? DEFAULT_CORE_MEMORY_PATH
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_CORE_TOKENS
    this.tokenCounter = options.tokenCounter ?? approximateTokenCount
    this.now = options.now ?? Date.now
  }

  async initialize(): Promise<void> {
    return this.serialize(async () => {
      const parsed = await this.readParsed()
      if (parsed.content !== '') return
      await this.writeAtomic(renderMemory([], 1))
    })
  }

  async read(): Promise<CoreMemorySnapshot> {
    return this.serialize(async () => {
      const parsed = await this.readParsed()
      return {
        content: parsed.content,
        entries: parsed.entries.map(({ lineIndex: _lineIndex, ...entry }) => entry),
        tokens: await this.tokenCounter(parsed.content)
      }
    })
  }

  async remember(content: string, replaces?: string): Promise<CoreMemoryWriteResult> {
    return this.serialize(async () => {
      const normalized = normalizeContent(content)
      if (!normalized) {
        throw new ToolError('invalid_args', '核心记忆内容不能为空')
      }
      assertSafeMemoryText(normalized)
      if (replaces !== undefined && !ID_PATTERN.test(replaces)) {
        throw new ToolError('invalid_args', '记忆编号格式无效')
      }

      const parsed = await this.readParsed()
      const newId = `m${parsed.nextId}`
      const lines = [...parsed.lines]

      if (replaces !== undefined) {
        const previous = parsed.entries.find((entry) => entry.id === replaces)
        if (!previous) {
          throw new ToolError('not_found', '要纠正的核心记忆不存在')
        }
        if (previous.replacedBy) {
          throw new ToolError('conflict', '该核心记忆已被纠正')
        }
        lines[previous.lineIndex] =
          `- [${previous.id}][已纠正 ${formatLocalDate(this.now())} → ${newId}] ${previous.content}`
      }

      const body = withoutCounter(lines)
      while (body.at(-1) === '') body.pop()
      body.push(`- [${newId}] ${normalized}`)
      const candidate = renderMemory(body, parsed.nextId + 1)
      const tokens = await this.tokenCounter(candidate)
      if (tokens > this.maxTokens) {
        throw new ToolError('limit_exceeded', '核心记忆将超过 Token 上限，请先清理或合并旧条目')
      }

      await this.writeAtomic(candidate)
      return { id: newId, tokens }
    })
  }

  async forget(id: string): Promise<CoreMemoryWriteResult> {
    return this.serialize(async () => {
      if (!ID_PATTERN.test(id)) {
        throw new ToolError('invalid_args', '记忆编号格式无效')
      }
      const parsed = await this.readParsed()
      const entry = parsed.entries.find((item) => item.id === id)
      if (!entry) {
        throw new ToolError('not_found', '核心记忆不存在')
      }

      const lines = [...parsed.lines]
      lines.splice(entry.lineIndex, 1)
      const candidate = renderMemory(withoutCounter(lines), parsed.nextId)
      const tokens = await this.tokenCounter(candidate)
      await this.writeAtomic(candidate)
      return { id, tokens }
    })
  }

  private async readParsed(): Promise<ParsedMemory> {
    let content: string
    try {
      content = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      content = ''
    }

    const lines = content === '' ? [] : content.replace(/\r\n/g, '\n').split('\n')
    let counter = 1
    for (const line of lines) {
      const match = COUNTER_PATTERN.exec(line)
      if (match) counter = Number(match[1])
    }

    const entries: ParsedMemory['entries'] = []
    let maximumId = 0
    lines.forEach((line, lineIndex) => {
      const match = ENTRY_PATTERN.exec(line)
      if (!match) return
      const numericId = Number(match[1]?.slice(1))
      maximumId = Math.max(maximumId, numericId)
      entries.push({
        id: match[1] as string,
        content: match[4] as string,
        correctedAt: match[2],
        replacedBy: match[3],
        lineIndex
      })
    })

    return {
      content,
      lines,
      entries,
      nextId: Math.max(counter, maximumId + 1)
    }
  }

  private async writeAtomic(content: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
      await rename(temporaryPath, this.path)
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

export function assertSafeMemoryText(content: string): void {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new ToolError('sensitive', '敏感信息不能写入长期记忆')
  }
}

export function approximateTokenCount(content: string): number {
  return Array.from(content).length
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\s*\r?\n\s*/g, ' ')
}

function withoutCounter(lines: string[]): string[] {
  return lines.filter((line) => !COUNTER_PATTERN.test(line))
}

function renderMemory(body: string[], nextId: number): string {
  return [`<!-- memory-next-id: ${nextId} -->`, ...body].join('\n').replace(/\n*$/, '\n')
}

function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
