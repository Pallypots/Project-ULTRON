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
import { NoteStore } from "./notes.ts";
import { DeviceStore } from "./devices.ts";
import { WatcherStore } from "./watchers.ts";

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
export { NoteStore, type Note } from "./notes.ts";
export { DeviceStore, type Device } from "./devices.ts";
export { WatcherStore, type Watcher } from "./watchers.ts";
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
  notes: NoteStore;
  devices: DeviceStore;
  watchers: WatcherStore;
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
    notes: new NoteStore(db),
    devices: new DeviceStore(db),
    watchers: new WatcherStore(db),
    close: () => db.close(),
  };
}
