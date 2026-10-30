export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

// Append-only. Never edit a migration that has shipped; add a new one.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "core",
    up: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL DEFAULT 'owner',
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('streaming','complete','error','cancelled')),
        provider TEXT,
        model TEXT,
        memory_ids TEXT NOT NULL DEFAULT '[]',
        source_device_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        source_conversation_id TEXT,
        source_message_id TEXT,
        confirmed INTEGER NOT NULL DEFAULT 1,
        pinned INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 1,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        review_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, memory_id UNINDEXED, tokenize = 'porter unicode61');

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target TEXT,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_created ON audit_events(created_at);

      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    down: `
      DROP TABLE preferences;
      DROP TABLE audit_events;
      DROP TABLE memories_fts;
      DROP TABLE memories;
      DROP TABLE messages;
      DROP TABLE conversations;
    `,
  },
  {
    version: 2,
    name: "message_input_mode",
    up: `ALTER TABLE messages ADD COLUMN input_mode TEXT NOT NULL DEFAULT 'text' CHECK (input_mode IN ('text','voice'));`,
    down: `ALTER TABLE messages DROP COLUMN input_mode;`,
  },
];
