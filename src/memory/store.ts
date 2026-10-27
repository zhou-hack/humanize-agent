// SQLite 单库：conversations + messages 两张表
// shortTerm / longTerm 只是查询视图，不做物理分库

export interface Conversation {
  id: string
  title: string | null // 会话结束时生成
  desc: string | null // 1-2 句结论性摘要，随索引进上下文
  created_at: number
  updated_at: number
}

export interface StoredMessage {
  conversation_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string // JSON 序列化
  created_at: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  "desc"     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
`

// TODO: 选定 SQLite 驱动（node:sqlite / better-sqlite3）后实现
export function initStore(): void {
  void SCHEMA
  throw new Error('not implemented')
}
