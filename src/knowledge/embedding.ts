import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ToolError } from '../tools/tool_calling/errors.js'
import { assertVector } from './vector.js'

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const DEFAULT_EMBEDDING_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
export const DEFAULT_EMBEDDING_CACHE_DIR = resolve(process.cwd(), 'src/data/knowledge/model_cache')

export type EmbeddingKind = 'query' | 'passage'

export interface EmbeddingProvider {
  readonly modelKey: string
  embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]>
  close(): Promise<void>
}

interface TensorLike {
  data: ArrayLike<number>
  dims: number[]
}

interface Extractor {
  (texts: string[], options: { pooling: 'mean'; normalize: true }): Promise<TensorLike>
  dispose(): Promise<void>
}

interface TransformersModule {
  env: { cacheDir: string | null }
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: {
      cache_dir: string
      revision: string
      device: 'cpu'
      dtype: 'q8'
      local_files_only: boolean
    }
  ): Promise<Extractor>
}

export interface LocalEmbeddingOptions {
  model?: string
  revision?: string
  cacheDir?: string
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelKey: string
  private readonly model: string
  private readonly revision: string
  private readonly cacheDir: string
  private extractor: Extractor | undefined
  private loading: Promise<Extractor> | undefined
  private closed = false

  constructor(options: LocalEmbeddingOptions = {}) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL
    this.revision = options.revision ?? DEFAULT_EMBEDDING_REVISION
    this.cacheDir = options.cacheDir ?? process.env.KNOWLEDGE_MODEL_CACHE_DIR ?? DEFAULT_EMBEDDING_CACHE_DIR
    this.modelKey = `${this.model}@${this.revision}/q8/mean-normalized/e5-prefix-v1`
  }

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    if (this.closed) throw new ToolError('conflict', '本地 Embedding 已关闭', false)
    try {
      const extractor = await this.getExtractor()
      const prefix = kind === 'query' ? 'query: ' : 'passage: '
      const output = await extractor(texts.map((text) => `${prefix}${text}`), {
        pooling: 'mean',
        normalize: true
      })
      return mapVectors(output, texts.length)
    } catch (error) {
      if (error instanceof ToolError) throw error
      throw new ToolError('internal', '本地 Embedding 加载或推理失败，请检查模型缓存及首次模型下载是否完成', true)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.loading) {
      try {
        await this.loading
      } catch {
        // 加载失败时无需释放未创建的 pipeline。
      }
    }
    const extractor = this.extractor
    this.extractor = undefined
    if (extractor) await extractor.dispose()
  }

  private async getExtractor(): Promise<Extractor> {
    if (this.extractor) return this.extractor
    this.loading ??= this.createExtractor()
    try {
      return await this.loading
    } finally {
      this.loading = undefined
    }
  }

  private async createExtractor(): Promise<Extractor> {
    const { env, pipeline } = await import('@huggingface/transformers') as unknown as TransformersModule
    env.cacheDir = this.cacheDir
    const cachedModelPath = resolve(this.cacheDir, this.model, this.revision)
    const useCachedModel = [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model_quantized.onnx'
    ].every((file) => existsSync(resolve(cachedModelPath, file)))
    const extractor = await pipeline('feature-extraction', useCachedModel ? cachedModelPath : this.model, {
      cache_dir: this.cacheDir,
      revision: this.revision,
      device: 'cpu',
      dtype: 'q8',
      local_files_only: useCachedModel
    })
    if (this.closed) {
      await extractor.dispose()
      throw new ToolError('conflict', '本地 Embedding 已关闭', false)
    }
    this.extractor = extractor
    return extractor
  }
}

function mapVectors(output: TensorLike, batchSize: number): Float32Array[] {
  if (output.dims.length !== 2 || output.dims[0] !== batchSize) {
    throw new ToolError('internal', '本地 Embedding 返回了异常批次形状')
  }
  const dimensions = output.dims[1] as number
  if (!Number.isInteger(dimensions) || dimensions <= 0 || output.data.length !== batchSize * dimensions) {
    throw new ToolError('internal', '本地 Embedding 返回了异常向量维度')
  }

  const vectors: Float32Array[] = []
  for (let batch = 0; batch < batchSize; batch += 1) {
    const vector = new Float32Array(dimensions)
    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = Number(output.data[batch * dimensions + index])
    }
    assertVector(vector, dimensions)
    vectors.push(vector)
  }
  return vectors
}
