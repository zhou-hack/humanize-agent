// SQLite 单库：conversations + messages + stickers，外加 FTS5 全文索引
// shortTerm / longTerm 只是查询视图，不做物理分库

export const SESSION_MAX_MS = 24 * 60 * 60 * 1000

export interface Conversation {
  id: string
  title: string | null // 首次闲置总结后生成
  desc: string | null // 1-2 句结论性摘要，随索引进上下文
  status: 'active' | 'closed'
  summarized_msg_id: number | null
  created_at: number
  last_message_at: number
  summarized_at: number | null
}

export interface StoredMessage {
  id: number
  conversation_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string // JSON 原样保存
  text: string // 从 content 提取的纯文本，图片以文字描述代替
  created_at: number
}

export interface Sticker {
  id: string
  path: string
  description: string
  emotions: string
  use_cases: string
  source_conversation_id: string | null
  created_at: number
}

// trigram 分词需要 SQLite >= 3.34
const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  title             TEXT,
  "desc"            TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  summarized_msg_id INTEGER,
  created_at        INTEGER NOT NULL,
  last_message_at   INTEGER NOT NULL,
  summarized_at     INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stickers (
  id                     TEXT PRIMARY KEY,
  path                   TEXT NOT NULL,
  description            TEXT NOT NULL,
  emotions               TEXT NOT NULL,
  use_cases              TEXT NOT NULL,
  source_conversation_id TEXT REFERENCES conversations(id),
  created_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_last ON conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

-- conversations 是 TEXT 主键，rowid 可能被 VACUUM 改写，故不用 external content
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  conversation_id UNINDEXED, title, "desc", tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS conversations_fts_upd AFTER UPDATE OF title, "desc" ON conversations BEGIN
  DELETE FROM conversations_fts WHERE conversation_id = old.id;
  INSERT INTO conversations_fts (conversation_id, title, "desc")
  SELECT new.id, new.title, new."desc" WHERE new.title IS NOT NULL;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text, content = 'messages', content_rowid = 'id', tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ins AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_del AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
`

// TODO: 选定 SQLite 驱动（node:sqlite / better-sqlite3）后实现
export function initStore(): void {
  void SCHEMA
  throw new Error('not implemented')
}
