import { openDatabase, type Db } from "./db.ts";
import { ConversationStore } from "./conversations.ts";
import { MemoryStore } from "./memories.ts";
import { AuditLog } from "./audit.ts";
import { PreferenceStore } from "./preferences.ts";
import { ReminderStore } from "./reminders.ts";
import { ActionStore } from "./actions.ts";
import { FileIndexStore } from "./files.ts";
import { ConnectorStore } from "./connectors.ts";
import { TodoStore } from "./todos.ts";

export { openDatabase, migrate, rollback, type Db } from "./db.ts";
export { MIGRATIONS } from "./migrations.ts";
export { ConversationStore, type ConversationHit } from "./conversations.ts";
export { MemoryStore, toFtsQuery } from "./memories.ts";
export { AuditLog, redact } from "./audit.ts";
export { PreferenceStore } from "./preferences.ts";
export { ReminderStore, type Reminder } from "./reminders.ts";
export { ActionStore, type ToolExecution, type ExecutionStatus } from "./actions.ts";
export { FileIndexStore, type Folder, type FileHit } from "./files.ts";
export { TodoStore, type Todo } from "./todos.ts";
export { ConnectorStore, type ConnectorEvent, type IntegrationRow, type NewConnectorEvent } from "./connectors.ts";

export interface Stores {
  db: Db;
  conversations: ConversationStore;
  memories: MemoryStore;
  audit: AuditLog;
  preferences: PreferenceStore;
  reminders: ReminderStore;
  actions: ActionStore;
  files: FileIndexStore;
  connectors: ConnectorStore;
  todos: TodoStore;
  close(): void;
}

export function openStores(file: string): Stores {
  const db = openDatabase(file);
  return {
    db,
    conversations: new ConversationStore(db),
    memories: new MemoryStore(db),
    audit: new AuditLog(db),
    preferences: new PreferenceStore(db),
    reminders: new ReminderStore(db),
    actions: new ActionStore(db),
    files: new FileIndexStore(db),
    connectors: new ConnectorStore(db),
    todos: new TodoStore(db),
    close: () => db.close(),
  };
}
