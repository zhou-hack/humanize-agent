import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ToolError } from '../tools/tool_calling/errors.js'

export const DEFAULT_DATABASE_PATH = resolve(process.cwd(), 'src/data/memory/memory.db')

export type ConversationStatus = 'active' | 'closed'
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Conversation {
  id: string
  title: string | null
  desc: string | null
  status: ConversationStatus
  summarizedMsgId: number | null
  createdAt: number
  lastMessageAt: number
  summarizedAt: number | null
}

export interface ConversationIndex {
  id: string
  title: string
  desc: string
  lastMessageAt: number
}

export interface StoredMessage {
  id: number
  conversationId: string
  role: MessageRole
  content: unknown
  text: string
  createdAt: number
}

export interface SearchConversation {
  id: string
  title: string | null
  desc: string | null
  lastMessageAt: number
}

export interface Sticker {
  id: string
  path: string
  description: string
  emotions: string[]
  useCases: string[]
  sourceConversationId: string | null
  createdAt: number
}

export interface AppendMessageInput {
  conversationId: string
  role: MessageRole
  content: unknown
  text?: string
  createdAt?: number
}

export interface ListMessagesOptions {
  afterId?: number
  throughId?: number
  offset?: number
  limit?: number
}

export interface MemoryStoreOptions {
  path?: string
}

export class MemoryStore {
  private readonly db: DatabaseSync

  constructor(options: MemoryStoreOptions = {}) {
    const databasePath = options.path ?? DEFAULT_DATABASE_PATH
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true })
    }

    this.db = new DatabaseSync(databasePath)
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      this.initializeSchema()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  createConversation(createdAt = Date.now(), id: string = randomUUID()): Conversation {
    this.db.prepare(`
      INSERT INTO conversations (id, status, created_at, last_message_at)
      VALUES (?, 'active', ?, ?)
    `).run(id, createdAt, createdAt)
    return this.getConversation(id)
  }

  getConversation(id: string): Conversation {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
    if (!row) {
      throw new ToolError('not_found', '会话不存在')
    }
    return mapConversation(row)
  }

  findConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
    return row ? mapConversation(row) : null
  }

  getLatestActiveConversation(): Conversation | null {
    const row = this.db.prepare(`
      SELECT * FROM conversations
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get()
    return row ? mapConversation(row) : null
  }

  listActiveConversations(): Conversation[] {
    return this.db.prepare("SELECT * FROM conversations WHERE status = 'active' ORDER BY created_at")
      .all().map(mapConversation)
  }

  closeConversation(id: string): void {
    const result = this.db.prepare("UPDATE conversations SET status = 'closed' WHERE id = ?").run(id)
    if (result.changes === 0) {
      throw new ToolError('not_found', '会话不存在')
    }
  }

  appendMessage(input: AppendMessageInput): StoredMessage {
    const createdAt = input.createdAt ?? Date.now()
    const content = JSON.stringify(input.content)
    if (content === undefined) {
      throw new ToolError('invalid_args', '消息内容必须可序列化为 JSON')
    }
    const text = input.text ?? extractText(input.content)

    return this.transaction(() => {
      if (!this.findConversation(input.conversationId)) {
        throw new ToolError('not_found', '会话不存在')
      }
      const result = this.db.prepare(`
        INSERT INTO messages (conversation_id, role, content, text, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.conversationId, input.role, content, text, createdAt)
      this.db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
        .run(createdAt, input.conversationId)
      return this.getMessage(Number(result.lastInsertRowid))
    })
  }

  getMessage(id: number): StoredMessage {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
    if (!row) {
      throw new ToolError('not_found', '消息不存在')
    }
    return mapMessage(row)
  }

  getLatestMessageId(conversationId: string): number | null {
    const row = this.db.prepare(`
      SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?
    `).get(conversationId) as { id: number | null }
    return row.id
  }

  listMessages(conversationId: string, options: ListMessagesOptions = {}): StoredMessage[] {
    const conditions = ['conversation_id = ?', 'id > ?']
    const parameters: Array<string | number> = [conversationId, options.afterId ?? 0]
    if (options.throughId !== undefined) {
      conditions.push('id <= ?')
      parameters.push(options.throughId)
    }

    let sql = `SELECT * FROM messages WHERE ${conditions.join(' AND ')} ORDER BY id`
    if (options.limit !== undefined) {
      sql += ' LIMIT ?'
      parameters.push(options.limit)
    }
    if (options.offset !== undefined) {
      if (options.limit === undefined) {
        sql += ' LIMIT -1'
      }
      sql += ' OFFSET ?'
      parameters.push(options.offset)
    }

    return this.db.prepare(sql).all(...parameters).map(mapMessage)
  }

  listPendingSummaryConversations(): Conversation[] {
    return this.db.prepare(`
      SELECT c.* FROM conversations c
      WHERE EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.id > COALESCE(c.summarized_msg_id, 0)
      )
      ORDER BY c.last_message_at
    `).all().map(mapConversation)
  }

  updateSummary(id: string, title: string, desc: string, targetMsgId: number, summarizedAt: number): void {
    const result = this.db.prepare(`
      UPDATE conversations
      SET title = ?, "desc" = ?, summarized_msg_id = ?, summarized_at = ?
      WHERE id = ? AND COALESCE(summarized_msg_id, 0) <= ?
    `).run(title, desc, targetMsgId, summarizedAt, id, targetMsgId)
    if (result.changes === 0) {
      throw new ToolError('conflict', '会话总结位置已更新，请重试')
    }
  }

  listRecentConversations(since: number, currentId?: string): ConversationIndex[] {
    return this.db.prepare(`
      SELECT id, title, "desc", last_message_at FROM conversations
      WHERE last_message_at >= ?
        AND title IS NOT NULL
        AND (? IS NULL OR id != ?)
      ORDER BY last_message_at DESC
    `).all(since, currentId ?? null, currentId ?? null).map(mapConversationIndex)
  }

  listConversationIndexes(from: number, before: number): ConversationIndex[] {
    return this.db.prepare(`
      SELECT id, title, "desc", last_message_at FROM conversations
      WHERE title IS NOT NULL AND last_message_at >= ? AND last_message_at < ?
      ORDER BY last_message_at DESC
    `).all(from, before).map(mapConversationIndex)
  }

  hasConversationIndexBefore(timestamp: number): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS found FROM conversations
      WHERE title IS NOT NULL AND last_message_at < ?
      LIMIT 1
    `).get(timestamp)
    return row !== undefined
  }

  searchByMatch(match: string, limit: number, offset: number): SearchConversation[] {
    return this.db.prepare(`
      WITH hits AS (
        SELECT c.id AS conversation_id, 0 AS priority, bm25(conversations_fts) AS rank
        FROM conversations_fts
        JOIN conversations c ON c.rowid = conversations_fts.rowid
        WHERE conversations_fts MATCH ?
        UNION ALL
        SELECT m.conversation_id, 1, bm25(messages_fts)
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH ?
      ), ranked AS (
        SELECT conversation_id, MIN(priority) AS priority, MIN(rank) AS rank
        FROM hits
        GROUP BY conversation_id
      )
      SELECT c.id, c.title, c."desc", c.last_message_at
      FROM ranked r
      JOIN conversations c ON c.id = r.conversation_id
      ORDER BY r.priority, r.rank, c.last_message_at DESC
      LIMIT ? OFFSET ?
    `).all(match, match, limit, offset).map(mapSearchConversation)
  }

  getMatchSnippets(conversationId: string, match: string, limit: number): string[] {
    return this.db.prepare(`
      SELECT snippet FROM (
        SELECT 0 AS priority, bm25(conversations_fts) AS rank,
          trim(
            snippet(conversations_fts, 0, '[', ']', '…', 12) || ' ' ||
            snippet(conversations_fts, 1, '[', ']', '…', 18)
          ) AS snippet
        FROM conversations_fts
        JOIN conversations c ON c.rowid = conversations_fts.rowid
        WHERE conversations_fts MATCH ? AND c.id = ?
        UNION ALL
        SELECT 1, bm25(messages_fts), snippet(messages_fts, 0, '[', ']', '…', 24)
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH ? AND m.conversation_id = ?
      )
      WHERE snippet != ''
      ORDER BY priority, rank
      LIMIT ?
    `).all(match, conversationId, match, conversationId, limit)
      .map((row) => (row as { snippet: string }).snippet)
  }

  searchByLike(pattern: string, limit: number, offset: number): SearchConversation[] {
    return this.db.prepare(`
      WITH hits AS (
        SELECT c.id AS conversation_id, 0 AS priority
        FROM conversations c
        WHERE c.title LIKE ? ESCAPE char(92) OR c."desc" LIKE ? ESCAPE char(92)
        UNION ALL
        SELECT m.conversation_id, 1
        FROM messages m
        WHERE m.text LIKE ? ESCAPE char(92)
      ), ranked AS (
        SELECT conversation_id, MIN(priority) AS priority
        FROM hits
        GROUP BY conversation_id
      )
      SELECT c.id, c.title, c."desc", c.last_message_at
      FROM ranked r
      JOIN conversations c ON c.id = r.conversation_id
      ORDER BY r.priority, c.last_message_at DESC
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, limit, offset).map(mapSearchConversation)
  }

  getLikeSnippetTexts(conversationId: string, pattern: string, limit: number): string[] {
    const conversation = this.getConversation(conversationId)
    const texts: string[] = []
    for (const value of [conversation.title, conversation.desc]) {
      if (!value) continue
      const row = this.db.prepare('SELECT ? LIKE ? ESCAPE char(92) AS matched').get(value, pattern) as { matched: number }
      if (row.matched === 1) texts.push(value)
    }

    if (texts.length < limit) {
      const rows = this.db.prepare(`
        SELECT text FROM messages
        WHERE conversation_id = ? AND text LIKE ? ESCAPE char(92)
        ORDER BY id DESC
        LIMIT ?
      `).all(conversationId, pattern, limit - texts.length)
      texts.push(...rows.map((row) => (row as { text: string }).text))
    }
    return texts.slice(0, limit)
  }

  insertSticker(sticker: Sticker): void {
    this.db.prepare(`
      INSERT INTO stickers (
        id, path, description, emotions, use_cases, source_conversation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sticker.id,
      sticker.path,
      sticker.description,
      JSON.stringify(sticker.emotions),
      JSON.stringify(sticker.useCases),
      sticker.sourceConversationId,
      sticker.createdAt
    )
  }

  getSticker(id: string): Sticker {
    const row = this.db.prepare('SELECT * FROM stickers WHERE id = ?').get(id)
    if (!row) {
      throw new ToolError('not_found', '表情包不存在')
    }
    return mapSticker(row)
  }

  searchStickers(pattern: string, limit: number): Sticker[] {
    return this.db.prepare(`
      SELECT * FROM stickers
      WHERE description LIKE ? ESCAPE char(92)
         OR emotions LIKE ? ESCAPE char(92)
         OR use_cases LIKE ? ESCAPE char(92)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, limit).map(mapSticker)
  }

  private initializeSchema(): void {
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT,
          "desc" TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
          summarized_msg_id INTEGER,
          created_at INTEGER NOT NULL,
          last_message_at INTEGER NOT NULL,
          summarized_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
          content TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS messages_conversation_id_id
          ON messages(conversation_id, id);
        CREATE INDEX IF NOT EXISTS conversations_last_message_at
          ON conversations(last_message_at DESC);

        CREATE TABLE IF NOT EXISTS stickers (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          description TEXT NOT NULL,
          emotions TEXT NOT NULL,
          use_cases TEXT NOT NULL,
          source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
          title,
          "desc",
          content='conversations',
          content_rowid='rowid',
          tokenize='trigram'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          text,
          content='messages',
          content_rowid='id',
          tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS conversations_fts_insert AFTER INSERT ON conversations BEGIN
          INSERT INTO conversations_fts(rowid, title, "desc")
          VALUES (new.rowid, new.title, new."desc");
        END;
        CREATE TRIGGER IF NOT EXISTS conversations_fts_delete AFTER DELETE ON conversations BEGIN
          INSERT INTO conversations_fts(conversations_fts, rowid, title, "desc")
          VALUES ('delete', old.rowid, old.title, old."desc");
        END;
        CREATE TRIGGER IF NOT EXISTS conversations_fts_update
          AFTER UPDATE OF title, "desc" ON conversations BEGIN
          INSERT INTO conversations_fts(conversations_fts, rowid, title, "desc")
          VALUES ('delete', old.rowid, old.title, old."desc");
          INSERT INTO conversations_fts(rowid, title, "desc")
          VALUES (new.rowid, new.title, new."desc");
        END;

        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF text ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
          INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
        END;
      `)

      if (version.user_version === 0) {
        this.db.exec(`
          INSERT INTO conversations_fts(conversations_fts) VALUES ('rebuild');
          INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
          PRAGMA user_version = 1;
        `)
      }
    } catch (error) {
      throw new Error('当前 SQLite 构建不支持记忆模块所需的 FTS5 trigram 分词', { cause: error })
    }
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

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(extractText).filter(Boolean).join('\n')
  }
  if (typeof content !== 'object' || content === null) return ''

  const record = content as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if ('content' in record) return extractText(record.content)
  return ''
}

function mapConversation(row: unknown): Conversation {
  const value = row as Record<string, unknown>
  return {
    id: value.id as string,
    title: value.title as string | null,
    desc: value.desc as string | null,
    status: value.status as ConversationStatus,
    summarizedMsgId: value.summarized_msg_id as number | null,
    createdAt: value.created_at as number,
    lastMessageAt: value.last_message_at as number,
    summarizedAt: value.summarized_at as number | null
  }
}

function mapConversationIndex(row: unknown): ConversationIndex {
  const value = row as Record<string, unknown>
  return {
    id: value.id as string,
    title: value.title as string,
    desc: (value.desc as string | null) ?? '',
    lastMessageAt: value.last_message_at as number
  }
}

function mapSearchConversation(row: unknown): SearchConversation {
  const value = row as Record<string, unknown>
  return {
    id: value.id as string,
    title: value.title as string | null,
    desc: value.desc as string | null,
    lastMessageAt: value.last_message_at as number
  }
}

function mapMessage(row: unknown): StoredMessage {
  const value = row as Record<string, unknown>
  return {
    id: value.id as number,
    conversationId: value.conversation_id as string,
    role: value.role as MessageRole,
    content: JSON.parse(value.content as string),
    text: value.text as string,
    createdAt: value.created_at as number
  }
}

function mapSticker(row: unknown): Sticker {
  const value = row as Record<string, unknown>
  return {
    id: value.id as string,
    path: value.path as string,
    description: value.description as string,
    emotions: JSON.parse(value.emotions as string) as string[],
    useCases: JSON.parse(value.use_cases as string) as string[],
    sourceConversationId: value.source_conversation_id as string | null,
    createdAt: value.created_at as number
  }
}
