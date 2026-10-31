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
  {
    version: 3,
    name: "actions_and_reminders",
    up: `
      ALTER TABLE messages ADD COLUMN tool_events TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE tool_executions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        conversation_id TEXT,
        tool TEXT NOT NULL,
        input TEXT NOT NULL,
        risk INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed','awaiting_approval','running','succeeded','failed','cancelled','denied','expired')),
        requested_by TEXT NOT NULL,
        summary TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX tool_exec_status ON tool_executions(status, created_at);
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        text TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('scheduled','fired','missed','cancelled')),
        source TEXT NOT NULL,
        conversation_id TEXT,
        created_at TEXT NOT NULL,
        fired_at TEXT
      );
      CREATE INDEX reminders_due ON reminders(status, due_at);
    `,
    down: `
      DROP TABLE reminders;
      DROP TABLE tool_executions;
      ALTER TABLE messages DROP COLUMN tool_events;
    `,
  },
  {
    version: 4,
    name: "file_index",
    up: `
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        detail TEXT NOT NULL DEFAULT '',
        file_count INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        indexed_at TEXT
      );
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        content_indexed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX documents_folder ON documents(folder_id);
      CREATE VIRTUAL TABLE document_chunks USING fts5(name, content, doc_id UNINDEXED, chunk UNINDEXED, tokenize = 'porter unicode61');
    `,
    down: `
      DROP TABLE document_chunks;
      DROP TABLE documents;
      DROP TABLE folders;
    `,
  },
  {
    version: 5,
    name: "connectors",
    up: `
      CREATE TABLE integrations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        account TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        cursor TEXT NOT NULL DEFAULT '{}',
        health TEXT NOT NULL DEFAULT 'not_connected',
        health_detail TEXT NOT NULL DEFAULT '',
        last_sync_at TEXT,
        next_sync_at TEXT,
        connected_at TEXT
      );
      CREATE TABLE connector_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        source TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        account_id TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        canonical_url TEXT,
        occurred_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        project_tags TEXT NOT NULL DEFAULT '[]',
        urgency INTEGER NOT NULL DEFAULT 0,
        read_state TEXT NOT NULL DEFAULT 'unread',
        why TEXT NOT NULL DEFAULT '',
        content_expiry TEXT,
        dedupe_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX connector_events_time ON connector_events(source, occurred_at);
    `,
    down: `
      DROP TABLE connector_events;
      DROP TABLE integrations;
    `,
  },
  {
    version: 6,
    name: "memory_vectors",
    up: `
      CREATE TABLE memory_vectors (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL
      );
    `,
    down: `DROP TABLE memory_vectors;`,
  },
  {
    version: 7,
    name: "todos",
    up: `
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        due_date TEXT,
        done_at TEXT,
        conversation_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX todos_open ON todos(done_at, created_at);
    `,
    down: `DROP TABLE todos;`,
  },
  {
    version: 8,
    name: "messages_fts",
    // Full-text index over past conversations, kept in sync by triggers (deleting a conversation removes it from the index).
    up: `
      CREATE VIRTUAL TABLE messages_fts USING fts5(content, content = 'messages', content_rowid = 'rowid', tokenize = 'porter unicode61');
      INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
      CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `,
    down: `
      DROP TRIGGER messages_fts_au;
      DROP TRIGGER messages_fts_ad;
      DROP TRIGGER messages_fts_ai;
      DROP TABLE messages_fts;
    `,
  },
  {
    version: 9,
    name: "conversation_summaries",
    // ULTRON's own short note of what each conversation was about (written when it goes quiet).
    up: `
      ALTER TABLE conversations ADD COLUMN summary TEXT;
      ALTER TABLE conversations ADD COLUMN summarized_at TEXT;
    `,
    down: `
      ALTER TABLE conversations DROP COLUMN summarized_at;
      ALTER TABLE conversations DROP COLUMN summary;
    `,
  },
];
