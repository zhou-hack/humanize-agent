import { randomUUID } from 'node:crypto'
import { ToolError } from '../tools/tool_calling/errors.js'
import { splitKnowledgeText } from './chunk.js'
import { LocalEmbeddingProvider, type EmbeddingProvider } from './embedding.js'
import {
  KnowledgeStore,
  type KnowledgeAudience,
  type KnowledgeChunkRecord,
  type KnowledgeEntryRecord
} from './store.js'
import { assertVector, cosineSimilarity, decodeVector, encodeVector } from './vector.js'

const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_TITLE_LENGTH = 256
const MAX_METADATA_BYTES = 16 * 1024

export interface AddKnowledgeInput {
  id?: string
  title?: string
  text: string
  metadata?: Record<string, unknown>
  audience?: KnowledgeAudience
}

export interface KnowledgeEntry {
  id: string
  title: string | null
  content: string
  metadata: Record<string, unknown>
  audience: KnowledgeAudience
  createdAt: number
  updatedAt: number
}

export interface EditKnowledgeInput {
  id: string
  title?: string
  text: string
  metadata?: Record<string, unknown>
  audience?: KnowledgeAudience
}

export interface AddKnowledgeResult {
  entry: KnowledgeEntry
  chunkCount: number
}

export interface SearchKnowledgeOptions {
  query: string
  limit?: number
  minScore?: number
  audience?: KnowledgeAudience
}

export interface KnowledgeSearchResult {
  entryId: string
  chunkId: string
  title: string | null
  chunkIndex: number
  text: string
  score: number
  audience: KnowledgeAudience
}

export interface KnowledgeServiceOptions {
  store?: KnowledgeStore
  embedding?: EmbeddingProvider
  databasePath?: string
  now?: () => number
}

export class KnowledgeService {
  readonly store: KnowledgeStore
  private readonly embedding: EmbeddingProvider
  private readonly now: () => number
  private operationQueue: Promise<void> = Promise.resolve()
  private closePromise: Promise<void> | undefined
  private closing = false

  constructor(options: KnowledgeServiceOptions = {}) {
    this.store = options.store ?? new KnowledgeStore({ path: options.databasePath })
    this.embedding = options.embedding ?? new LocalEmbeddingProvider()
    this.now = options.now ?? Date.now
  }

  add(input: AddKnowledgeInput): Promise<AddKnowledgeResult> {
    return this.serialize(() => this.write(input, false))
  }

  edit(input: EditKnowledgeInput): Promise<AddKnowledgeResult> {
    return this.serialize(() => this.write(input, true))
  }

  delete(id: string): Promise<boolean> {
    return this.serialize(async () => {
      if (!id.trim()) throw new ToolError('invalid_args', '知识条目 ID 不能为空')
      return this.store.deleteEntry(id)
    })
  }

  search(options: SearchKnowledgeOptions): Promise<KnowledgeSearchResult[]> {
    return this.serialize(async () => {
      const query = options.query.trim()
      if (!query) throw new ToolError('invalid_args', '知识检索 query 不能为空')
      const limit = options.limit ?? 5
      if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
        throw new ToolError('invalid_args', '知识检索 limit 必须是 1–8 的整数')
      }
      if (options.minScore !== undefined && (!Number.isFinite(options.minScore) || options.minScore < -1 || options.minScore > 1)) {
        throw new ToolError('invalid_args', '知识检索 minScore 必须位于 -1 到 1 之间')
      }
      if (!this.store.hasChunks(options.audience)) return []

      const model = this.store.getEmbeddingMetadata()
      if (!model) throw new ToolError('internal', '知识库切片缺少 Embedding 元数据')
      if (model.modelKey !== this.embedding.modelKey) {
        throw new ToolError('conflict', '知识库与当前 Embedding 模型不一致，请使用原模型或重建知识库', false)
      }
      const queryVector = (await this.embedding.embed([query], 'query'))[0]
      if (!queryVector) throw new ToolError('internal', 'Embedding 未返回查询向量')
      if (queryVector.length !== model.dimensions) {
        throw new ToolError('conflict', '查询向量与知识库维度不一致，请使用原模型或重建知识库', false)
      }
      assertVector(queryVector)

      const results: KnowledgeSearchResult[] = []
      for (const chunk of this.store.listVectorChunks(options.audience)) {
        const vector = decodeVector(chunk.embedding, model.dimensions)
        const score = cosineSimilarity(queryVector, vector)
        if (options.minScore !== undefined && score < options.minScore) continue
        results.push({
          entryId: chunk.entryId,
          chunkId: chunk.chunkId,
          title: chunk.title,
          chunkIndex: chunk.chunkIndex,
          text: chunk.content,
          score,
          audience: chunk.audience
        })
      }
      results.sort((left, right) => right.score - left.score || (left.chunkId < right.chunkId ? -1 : left.chunkId > right.chunkId ? 1 : 0))
      return results.slice(0, limit)
    })
  }

  close(): Promise<void> {
    this.closePromise ??= (() => {
      this.closing = true
      const closing = this.operationQueue.then(async () => {
        try {
          await this.embedding.close()
        } finally {
          this.store.close()
        }
      })
      this.operationQueue = closing.then(() => undefined, () => undefined)
      return closing
    })()
    return this.closePromise
  }

  private async write(input: AddKnowledgeInput, replace: boolean): Promise<AddKnowledgeResult> {
    let previous: KnowledgeEntryRecord | null = null
    if (replace) {
      const id = input.id?.trim()
      if (!id) throw new ToolError('invalid_args', '知识条目 ID 不能为空')
      previous = this.store.getEntry(id)
      if (!previous) throw new ToolError('not_found', '知识条目不存在')
    }
    const audience = input.audience ?? previous?.audience ?? 'student'
    if (previous && previous.audience !== audience) {
      throw new ToolError('not_found', '知识条目不存在')
    }
    const normalized = normalizeInput({
      ...input,
      audience,
      title: input.title ?? previous?.title ?? undefined,
      metadata: input.metadata ?? (previous
        ? JSON.parse(previous.metadataJson) as Record<string, unknown>
        : undefined)
    })
    const chunks = splitKnowledgeText(normalized.content)
    if (chunks.length === 0) throw new ToolError('invalid_args', '知识正文不能为空')

    const existing = this.store.getEmbeddingMetadata()
    if (existing && existing.modelKey !== this.embedding.modelKey) {
      throw new ToolError('conflict', '知识库与当前 Embedding 模型不一致，请使用原模型或重建知识库', false)
    }
    const vectors = await this.embedding.embed(chunks, 'passage')
    if (vectors.length !== chunks.length || vectors.length === 0) {
      throw new ToolError('internal', 'Embedding 返回批次数量与知识切片不一致')
    }
    const dimensions = vectors[0]?.length ?? 0
    for (const vector of vectors) assertVector(vector, dimensions)

    const timestamp = this.now()
    const createdAt = previous?.createdAt ?? timestamp
    const entry: KnowledgeEntryRecord = {
      id: normalized.id,
      title: normalized.title,
      content: normalized.content,
      metadataJson: normalized.metadataJson,
      audience: normalized.audience,
      createdAt,
      updatedAt: timestamp
    }
    const chunkRecords: KnowledgeChunkRecord[] = chunks.map((content, chunkIndex) => ({
      id: randomUUID(),
      entryId: normalized.id,
      chunkIndex,
      content,
      embedding: encodeVector(vectors[chunkIndex] as Float32Array)
    }))
    if (replace) {
      this.store.updateEntry(entry, chunkRecords, {
        modelKey: this.embedding.modelKey,
        dimensions
      })
    } else {
      this.store.insertEntry(entry, chunkRecords, {
        modelKey: this.embedding.modelKey,
        dimensions
      })
    }
    return {
      entry: {
        id: normalized.id,
        title: normalized.title,
        content: normalized.content,
        metadata: normalized.metadata,
        audience: normalized.audience,
        createdAt,
        updatedAt: timestamp
      },
      chunkCount: chunks.length
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new ToolError('conflict', '知识库服务已关闭', false))
    }
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function normalizeInput(input: AddKnowledgeInput): {
  id: string
  title: string | null
  content: string
  metadata: Record<string, unknown>
  metadataJson: string
  audience: KnowledgeAudience
} {
  if (input.audience !== undefined && input.audience !== 'student' && input.audience !== 'leader') {
    throw new ToolError('invalid_args', '知识 audience 仅支持 student 或 leader')
  }
  const audience = input.audience ?? 'student'
  if (typeof input.text !== 'string') throw new ToolError('invalid_args', '知识正文必须是字符串')
  const content = input.text.replaceAll('\r\n', '\n').trim()
  if (!content) throw new ToolError('invalid_args', '知识正文不能为空')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new ToolError('limit_exceeded', '单条知识正文不能超过 1 MiB', false)
  }
  const title = input.title?.trim() || null
  if (title && title.length > MAX_TITLE_LENGTH) {
    throw new ToolError('limit_exceeded', '知识标题不能超过 256 个字符', false)
  }
  const id = input.id?.trim() || randomUUID()
  const metadata = input.metadata ?? {}
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new ToolError('invalid_args', '知识 metadata 必须是 JSON 对象')
  }
  let metadataJson: string
  try {
    metadataJson = JSON.stringify(metadata)
  } catch {
    throw new ToolError('invalid_args', '知识 metadata 必须可序列化为 JSON')
  }
  if (!metadataJson) throw new ToolError('invalid_args', '知识 metadata 必须可序列化为 JSON 对象')
  if (Buffer.byteLength(metadataJson, 'utf8') > MAX_METADATA_BYTES) {
    throw new ToolError('limit_exceeded', '知识 metadata 不能超过 16 KiB', false)
  }
  return { id, title, content, metadata, metadataJson, audience }
}

export { LocalEmbeddingProvider } from './embedding.js'
export type { EmbeddingKind, EmbeddingProvider } from './embedding.js'
export { KnowledgeStore } from './store.js'
export type { KnowledgeAudience } from './store.js'
