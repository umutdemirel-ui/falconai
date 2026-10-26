import fs from 'node:fs';
import { JsonCollection, uid } from './store';
import { paths } from './paths';
import type {
  AgendaDigest,
  ChatMessage,
  Conversation,
  DelegationRecord,
  FileRecord,
  MemoryEntry,
  Project,
  Reminder,
  TaskItem,
} from '../../shared/types';

/**
 * Yerel veri koleksiyonları. Tümü kullanıcı profilinde JSON olarak saklanır;
 * harici bir sunucuya hiçbir veri gönderilmez (yalnızca seçili sağlayıcının API istekleri hariç).
 */

/* ------------------------------- Sohbet ------------------------------- */

export type StoredMessage = ChatMessage;

interface ChatStore {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
}

export const chats = new JsonCollection<ChatStore>(
  () => paths.chats(),
  () => ({ conversations: [], messages: {} }),
);

export function newConversation(title = 'Yeni sohbet'): Conversation {
  const now = Date.now();
  const conv: Conversation = { id: uid('c'), title, createdAt: now, updatedAt: now, messageCount: 0 };
  chats.update((s) => {
    s.conversations.unshift(conv);
    s.messages[conv.id] = [];
  });
  return conv;
}

export function listConversations(): Conversation[] {
  return [...chats.read().conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMessages(conversationId: string): StoredMessage[] {
  return chats.read().messages[conversationId] ?? [];
}

export function appendMessage(conversationId: string, message: StoredMessage): void {
  chats.update((s) => {
    const list = s.messages[conversationId] ?? [];
    const idx = list.findIndex((m) => m.id === message.id);
    if (idx >= 0) list[idx] = message;
    else list.push(message);
    s.messages[conversationId] = list;
    const conv = s.conversations.find((c) => c.id === conversationId);
    if (conv) {
      conv.updatedAt = Date.now();
      conv.messageCount = list.length;
      if (conv.title === 'Yeni sohbet' && message.role === 'user' && typeof message.text === 'string') {
        conv.title = String(message.text).slice(0, 48);
      }
    }
  });
}

export function deleteConversation(id: string): void {
  chats.update((s) => {
    s.conversations = s.conversations.filter((c) => c.id !== id);
    delete s.messages[id];
  });
}

export function renameConversation(id: string, title: string): void {
  chats.update((s) => {
    const conv = s.conversations.find((c) => c.id === id);
    if (conv) conv.title = title;
  });
}

export function clearAllChats(): void {
  chats.write({ conversations: [], messages: {} });
}

/* ------------------------------ Projeler ------------------------------ */

export const projects = new JsonCollection<Project[]>(
  () => paths.projects(),
  () => [],
);

export function listProjects(): Project[] {
  return [...projects.read()].sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt));
}

export function createProject(input: { name: string; description?: string; icon?: string; color?: string }): Project {
  const now = Date.now();
  const project: Project = {
    id: uid('p'),
    name: input.name,
    description: input.description ?? '',
    icon: input.icon ?? 'folder',
    color: input.color,
    files: [],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
  projects.update((list) => [...list, project]);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  let updated: Project | null = null;
  projects.update((list) =>
    list.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...patch, updatedAt: Date.now() };
      return updated;
    }),
  );
  return updated;
}

export function deleteProject(id: string): void {
  projects.update((list) => list.filter((p) => p.id !== id));
  tasks.update((list) => list.filter((t) => t.projectId !== id));
}

/* ------------------------------- Görevler ----------------------------- */

export const tasks = new JsonCollection<TaskItem[]>(
  () => paths.tasks(),
  () => [],
);

export function listTasks(): TaskItem[] {
  return [...tasks.read()].sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    return (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt);
  });
}

export function addTask(input: Partial<TaskItem> & { title: string }): TaskItem {
  const task: TaskItem = {
    id: uid('t'),
    title: input.title,
    detail: input.detail,
    done: false,
    priority: input.priority ?? 'normal',
    dueAt: input.dueAt,
    projectId: input.projectId,
    createdAt: Date.now(),
  };
  tasks.update((list) => [...list, task]);
  return task;
}

export function toggleTask(id: string, done?: boolean): TaskItem | null {
  let out: TaskItem | null = null;
  tasks.update((list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      out = { ...t, done: done ?? !t.done, completedAt: (done ?? !t.done) ? Date.now() : undefined };
      return out;
    }),
  );
  return out;
}

export function deleteTask(id: string): void {
  tasks.update((list) => list.filter((t) => t.id !== id));
}

/* ----------------------------- Hatırlatıcı ---------------------------- */

export const reminders = new JsonCollection<Reminder[]>(
  () => paths.reminders(),
  () => [],
);

export function listReminders(): Reminder[] {
  return [...reminders.read()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

export function addReminder(input: { text: string; at?: number; dailyAt?: string }): Reminder {
  const reminder: Reminder = {
    id: uid('r'),
    text: input.text,
    at: input.at,
    dailyAt: input.dailyAt,
    enabled: true,
    createdAt: Date.now(),
  };
  reminders.update((list) => [...list, reminder]);
  return reminder;
}

export function updateReminder(id: string, patch: Partial<Reminder>): void {
  reminders.update((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function deleteReminder(id: string): void {
  reminders.update((list) => list.filter((r) => r.id !== id));
}

/* -------------------------------- Hafıza ------------------------------ */

export const memories = new JsonCollection<MemoryEntry[]>(
  () => paths.memories(),
  () => [],
);

export function listMemories(): MemoryEntry[] {
  return [...memories.read()].sort((a, b) => b.createdAt - a.createdAt);
}

export function addMemory(text: string, tags: string[] = [], source: 'user' | 'agent' = 'user'): MemoryEntry {
  const entry: MemoryEntry = { id: uid('m'), text, tags, createdAt: Date.now(), source };
  memories.update((list) => [...list.slice(-199), entry]);
  return entry;
}

export function deleteMemory(id: string): void {
  memories.update((list) => list.filter((m) => m.id !== id));
}

/* -------------------------------- Dosyalar ---------------------------- */

export const files = new JsonCollection<FileRecord[]>(
  () => paths.files(),
  () => [],
);

export function listFiles(): FileRecord[] {
  return [...files.read()].sort((a, b) => b.addedAt - a.addedAt);
}

export function addFileRecord(input: Omit<FileRecord, 'id' | 'addedAt'>): FileRecord {
  const record: FileRecord = { ...input, id: uid('f'), addedAt: Date.now() };
  files.update((list) => {
    const filtered = list.filter((f) => f.path !== record.path);
    return [...filtered, record];
  });
  return record;
}

export function updateFileRecord(id: string, patch: Partial<FileRecord>): void {
  files.update((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

export function deleteFileRecord(id: string): void {
  files.update((list) => list.filter((f) => f.id !== id));
}

/* ------------------------------- Gündem ------------------------------- */

export interface AgendaStore {
  digests: AgendaDigest[];
  lastRunAt?: number;
}

export const agendaStore = new JsonCollection<AgendaStore>(
  () => paths.agenda(),
  () => ({ digests: [] }),
);

export function listDigests(): AgendaDigest[] {
  return [...agendaStore.read().digests];
}

export function saveDigest(digest: AgendaDigest): void {
  agendaStore.update((s) => ({ digests: [digest, ...s.digests].slice(0, 30), lastRunAt: Date.now() }));
}

/* ----------------------------- Delegasyon ----------------------------- */

export const delegations = new JsonCollection<DelegationRecord[]>(
  () => paths.delegations(),
  () => [],
);

export function listDelegations(): DelegationRecord[] {
  return [...delegations.read()].slice(-50).reverse();
}

export function saveDelegation(record: DelegationRecord): void {
  delegations.update((list) => [...list.slice(-99), record]);
}

/* -------------------------------- Yedek ------------------------------- */

export function exportBackup(): string {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    chats: chats.read(),
    projects: projects.read(),
    tasks: tasks.read(),
    reminders: reminders.read(),
    memories: memories.read(),
    files: files.read(),
    agenda: agendaStore.read(),
    delegations: delegations.read(),
  };
  const file = `${paths.exports()}/falcon-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  return file;
}

export function importBackup(source: string): string {
  const raw = fs.readFileSync(source, 'utf8');
  const data = JSON.parse(raw) as ReturnType<typeof exportBackup> extends never ? never : Record<string, unknown>;
  if (data.chats) chats.write(data.chats as ChatStore);
  if (data.projects) projects.write(data.projects as Project[]);
  if (data.tasks) tasks.write(data.tasks as TaskItem[]);
  if (data.reminders) reminders.write(data.reminders as Reminder[]);
  if (data.memories) memories.write(data.memories as MemoryEntry[]);
  if (data.files) files.write(data.files as FileRecord[]);
  if (data.agenda) agendaStore.write(data.agenda as AgendaStore);
  if (data.delegations) delegations.write(data.delegations as DelegationRecord[]);
  return 'Yedek geri yüklendi.';
}

export function resetAll(): void {
  chats.write({ conversations: [], messages: {} });
  projects.write([]);
  tasks.write([]);
  reminders.write([]);
  memories.write([]);
  files.write([]);
  agendaStore.write({ digests: [] });
  delegations.write([]);
}
