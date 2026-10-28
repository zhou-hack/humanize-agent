import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ToolError } from '../tools/tool_calling/errors.js'
import { assertSafeMemoryText } from './core.js'
import { toLikePattern } from './search.js'
import type { MemoryStore, Sticker } from './store.js'

export const DEFAULT_STICKER_DIRECTORY = resolve(process.cwd(), 'src/data/multimedia/stickers')
export const MAX_STICKER_BYTES = 10 * 1024 * 1024

export interface StickerMetadata {
  id: string
  description: string
  emotions: string[]
  use_cases: string[]
  source_conversation_id: string | null
  created_at: number
}

export interface SaveStickerInput {
  image: Uint8Array
  description: string
  emotions: string[]
  useCases: string[]
  sourceConversationId?: string
}

export interface StickerMemoryOptions {
  directory?: string
  now?: () => number
}

export class StickerMemory {
  readonly directory: string
  private readonly now: () => number

  constructor(private readonly store: MemoryStore, options: StickerMemoryOptions = {}) {
    this.directory = options.directory ?? DEFAULT_STICKER_DIRECTORY
    this.now = options.now ?? Date.now
  }

  async save(input: SaveStickerInput): Promise<StickerMetadata> {
    const description = input.description.trim()
    if (!description) {
      throw new ToolError('invalid_args', '表情包描述不能为空')
    }
    if (input.image.byteLength === 0) {
      throw new ToolError('invalid_args', '表情包图片不能为空')
    }
    if (input.image.byteLength > MAX_STICKER_BYTES) {
      throw new ToolError('limit_exceeded', '表情包图片不能超过 10 MiB')
    }
    const emotions = normalizeLabels(input.emotions)
    const useCases = normalizeLabels(input.useCases)
    assertSafeMemoryText([description, ...emotions, ...useCases].join('\n'))

    const extension = detectImageExtension(input.image)
    const id = randomUUID()
    const fileName = `${id}.${extension}`
    const filePath = join(this.directory, fileName)
    const sticker: Sticker = {
      id,
      path: fileName,
      description,
      emotions,
      useCases,
      sourceConversationId: input.sourceConversationId ?? null,
      createdAt: this.now()
    }

    await mkdir(this.directory, { recursive: true })
    await writeFile(filePath, input.image, { flag: 'wx' })
    try {
      this.store.insertSticker(sticker)
    } catch (error) {
      await unlink(filePath).catch(() => undefined)
      throw error
    }
    return toMetadata(sticker)
  }

  search(query: string, limit = 5): StickerMetadata[] {
    const normalized = query.trim()
    if (!normalized) {
      throw new ToolError('invalid_args', '表情包检索关键词不能为空')
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new ToolError('invalid_args', 'limit 必须是 1 到 10 之间的整数')
    }
    return this.store.searchStickers(toLikePattern(normalized), limit).map(toMetadata)
  }

  get(id: string): StickerMetadata {
    return toMetadata(this.store.getSticker(id))
  }

  getFilePath(id: string): string {
    const sticker = this.store.getSticker(id)
    return join(this.directory, sticker.path)
  }
}

function detectImageExtension(image: Uint8Array): string {
  if (image.length >= 8 && image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47) {
    return 'png'
  }
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'jpg'
  }
  if (image.length >= 6 && ascii(image, 0, 6) === 'GIF89a' || image.length >= 6 && ascii(image, 0, 6) === 'GIF87a') {
    return 'gif'
  }
  if (image.length >= 12 && ascii(image, 0, 4) === 'RIFF' && ascii(image, 8, 12) === 'WEBP') {
    return 'webp'
  }
  throw new ToolError('unsupported_file', '仅支持 PNG、JPEG、GIF 和 WebP 表情包')
}

function ascii(image: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...image.slice(start, end))
}

function normalizeLabels(labels: string[]): string[] {
  return labels.map((label) => label.trim()).filter(Boolean)
}

function toMetadata(sticker: Sticker): StickerMetadata {
  return {
    id: sticker.id,
    description: sticker.description,
    emotions: sticker.emotions,
    use_cases: sticker.useCases,
    source_conversation_id: sticker.sourceConversationId,
    created_at: sticker.createdAt
  }
}
