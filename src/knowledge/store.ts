import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ToolError } from '../tools/tool_calling/errors.js'

export const DEFAULT_KNOWLEDGE_DATABASE_PATH = resolve(process.cwd(), 'src/data/knowledge/knowledge.db')
export const KNOWLEDGE_VECTOR_FORMAT = 'float32le-cosine-v1'

export type KnowledgeAudience = 'student' | 'leader'

export interface KnowledgeEntryRecord {
  id: string
  title: string | null
  content: string
  metadataJson: string
  audience: KnowledgeAudience
  createdAt: number
  updatedAt: number
}

export interface KnowledgeChunkRecord {
  id: string
  entryId: string
  chunkIndex: number
  content: string
  embedding: Uint8Array
}

export interface KnowledgeEmbeddingMetadata {
  modelKey: string
  dimensions: number
  vectorFormat: string
}

export interface KnowledgeVectorChunk {
  entryId: string
  chunkId: string
  title: string | null
  chunkIndex: number
  content: string
  embedding: Uint8Array
  audience: KnowledgeAudience
}

export interface KnowledgeStoreOptions {
  path?: string
}

export class KnowledgeStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(options: KnowledgeStoreOptions = {}) {
    const databasePath = options.path ?? process.env.KNOWLEDGE_DATABASE_PATH ?? DEFAULT_KNOWLEDGE_DATABASE_PATH
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
      this.initializeSchema()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  getEmbeddingMetadata(): KnowledgeEmbeddingMetadata | null {
    const row = this.db.prepare(`
      SELECT model_key, dimensions, vector_format FROM knowledge_embedding WHERE id = 1
    `).get() as { model_key: string; dimensions: number; vector_format: string } | undefined
    if (!row) return null
    if (row.vector_format !== KNOWLEDGE_VECTOR_FORMAT) {
      throw new ToolError('internal', '知识库使用了不支持的向量格式')
    }
    return {
      modelKey: row.model_key,
      dimensions: row.dimensions,
      vectorFormat: row.vector_format
    }
  }

  hasChunks(audience?: KnowledgeAudience): boolean {
    const row = audience
      ? this.db.prepare(`
        SELECT EXISTS(
          SELECT 1 FROM knowledge_chunks c
          JOIN knowledge_entries e ON e.id = c.entry_id
          WHERE e.audience = ? LIMIT 1
        ) AS present
      `).get(audience) as { present: number }
      : this.db.prepare('SELECT EXISTS(SELECT 1 FROM knowledge_chunks LIMIT 1) AS present').get() as { present: number }
    return row.present === 1
  }

  getEntry(id: string): KnowledgeEntryRecord | null {
    const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as {
      id: string
      title: string | null
      content: string
      metadata_json: string
      audience: KnowledgeAudience
      created_at: number
      updated_at: number
    } | undefined
    return row ? {
      id: row.id,
      title: row.title,
      content: row.content,
      metadataJson: row.metadata_json,
      audience: row.audience,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } : null
  }

  insertEntry(
    entry: KnowledgeEntryRecord,
    chunks: KnowledgeChunkRecord[],
    model: { modelKey: string; dimensions: number }
  ): void {
    this.writeEntry(entry, chunks, model, false)
  }

  updateEntry(
    entry: KnowledgeEntryRecord,
    chunks: KnowledgeChunkRecord[],
    model: { modelKey: string; dimensions: number }
  ): void {
    this.writeEntry(entry, chunks, model, true)
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id)
    return result.changes > 0
  }

  listVectorChunks(audience?: KnowledgeAudience): KnowledgeVectorChunk[] {
    const rows = this.db.prepare(`
      SELECT c.entry_id, c.id AS chunk_id, e.title, c.chunk_index, c.content, c.embedding, e.audience
      FROM knowledge_chunks c
      JOIN knowledge_entries e ON e.id = c.entry_id
      ${audience ? 'WHERE e.audience = ?' : ''}
      ORDER BY c.entry_id, c.chunk_index
    `).all(...(audience ? [audience] : [])) as Array<{
      entry_id: string
      chunk_id: string
      title: string | null
      chunk_index: number
      content: string
      embedding: Uint8Array
      audience: KnowledgeAudience
    }>
    return rows.map((row) => ({
      entryId: row.entry_id,
      chunkId: row.chunk_id,
      title: row.title,
      chunkIndex: row.chunk_index,
      content: row.content,
      embedding: row.embedding,
      audience: row.audience
    }))
  }

  private writeEntry(
    entry: KnowledgeEntryRecord,
    chunks: KnowledgeChunkRecord[],
    model: { modelKey: string; dimensions: number },
    replace: boolean
  ): void {
    if (chunks.length === 0) throw new ToolError('invalid_args', '知识条目至少需要一个切片')
    this.transaction(() => {
      const existing = this.getEmbeddingMetadata()
      if (existing && (existing.modelKey !== model.modelKey || existing.dimensions !== model.dimensions)) {
        throw new ToolError('conflict', '知识库与当前 Embedding 模型或维度不一致', false)
      }
      const current = this.getEntry(entry.id)
      if (replace && !current) throw new ToolError('not_found', '知识条目不存在')
      if (!replace && current) throw new ToolError('conflict', '知识条目 ID 已存在', false)

      this.db.prepare(`
        INSERT INTO knowledge_embedding (id, model_key, dimensions, vector_format)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(model.modelKey, model.dimensions, KNOWLEDGE_VECTOR_FORMAT)
      if (replace) {
        this.db.prepare(`
          UPDATE knowledge_entries
          SET title = ?, content = ?, metadata_json = ?, audience = ?, created_at = ?, updated_at = ?
          WHERE id = ?
        `).run(entry.title, entry.content, entry.metadataJson, entry.audience, entry.createdAt, entry.updatedAt, entry.id)
        this.db.prepare('DELETE FROM knowledge_chunks WHERE entry_id = ?').run(entry.id)
      } else {
        this.db.prepare(`
          INSERT INTO knowledge_entries (id, title, content, metadata_json, audience, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(entry.id, entry.title, entry.content, entry.metadataJson, entry.audience, entry.createdAt, entry.updatedAt)
      }

      const insertChunk = this.db.prepare(`
        INSERT INTO knowledge_chunks (id, entry_id, chunk_index, content, embedding)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const chunk of chunks) {
        insertChunk.run(chunk.id, chunk.entryId, chunk.chunkIndex, chunk.content, chunk.embedding)
      }
    })
  }

  private initializeSchema(): void {
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 2) {
      throw new ToolError('conflict', '知识库 schema 版本高于当前程序，已拒绝打开', false)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT 'student' CHECK (audience IN ('student', 'leader')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        UNIQUE(entry_id, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS knowledge_chunks_entry_id ON knowledge_chunks(entry_id);
      CREATE TABLE IF NOT EXISTS knowledge_embedding (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        model_key TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector_format TEXT NOT NULL
      );
    `)
    const columns = this.db.prepare('PRAGMA table_info(knowledge_entries)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'audience')) {
      this.db.exec(`
        ALTER TABLE knowledge_entries
        ADD COLUMN audience TEXT NOT NULL DEFAULT 'student' CHECK (audience IN ('student', 'leader'));
      `)
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS knowledge_entries_audience ON knowledge_entries(audience);
      PRAGMA user_version = 2;
    `)
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
