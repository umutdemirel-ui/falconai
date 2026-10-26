import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiTestResult,
  AppInfo,
  AgendaDigest,
  Attachment,
  AuditEntry,
  ChatEvent,
  ChatMessage,
  ChatRequest,
  Config,
  Conversation,
  DelegationRecord,
  FileRecord,
  MemoryEntry,
  ModelInfo,
  Project,
  Reminder,
  RunningProcess,
  SystemInfo,
  TaskItem,
  ToolConfirmation,
} from '../shared/types';

/**
 * Güvenli köprü. Renderer yalnızca bu API'ye erişebilir; Node/Electron
 * yetkileri doğrudan verilmez (contextIsolation açık).
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  /* ------------------------------ Ayarlar ------------------------------ */
  config: {
    get: () => invoke<Config>('config:get'),
    update: (patch: Partial<Config>) => invoke<Config>('config:update', patch),
    setApiKey: (key: string) => invoke<Config>('config:set-key', key),
    maskedKey: () => invoke<string>('config:masked-key'),
    test: () => invoke<ApiTestResult>('config:test'),
    models: (force?: boolean) => invoke<ModelInfo[]>('config:models', force),
    reset: () => invoke<Config>('config:reset'),
    setProviderKey: (provider: string, key: string) => invoke<Config>('config:set-provider-key', provider, key),
    setProviderModel: (provider: string, model: string) => invoke<Config>('config:set-provider-model', provider, model),
    testProvider: (provider: string) => invoke<ApiTestResult>('config:test-provider', provider),
    providerModels: (provider: string) => invoke<string[]>('config:provider-models', provider),
  },

  /* ------------------------------ Sohbet ------------------------------- */
  chat: {
    send: (request: ChatRequest) => invoke<{ conversationId: string; assistantMessage: ChatMessage; spokenText: string }>('chat:send', request),
    stop: () => invoke<void>('chat:stop'),
    list: () => invoke<Conversation[]>('chat:list'),
    messages: (conversationId: string) => invoke<ChatMessage[]>('chat:messages', conversationId),
    new: (title?: string) => invoke<Conversation>('chat:new', title),
    remove: (id: string) => invoke<void>('chat:remove', id),
    rename: (id: string, title: string) => invoke<void>('chat:rename', id, title),
    clear: () => invoke<void>('chat:clear'),
    export: (id: string) => invoke<string | null>('chat:export', id),
  },

  /* -------------------------------- Ses -------------------------------- */
  voice: {
    speak: (text: string, voice?: string) =>
      invoke<{ audioBase64: string; mime: string; model: string; chars: number; chunks: number; provider?: string }>('voice:speak', text, voice),
    transcribe: (audioBase64: string, mime: string, hint?: string) =>
      invoke<{ text: string; provider?: string }>('voice:transcribe', audioBase64, mime, hint),
    askMicPermission: () => invoke<boolean>('voice:mic-permission'),
  },

  /* ------------------------------- Sistem ------------------------------ */
  system: {
    info: () => invoke<SystemInfo>('system:info'),
    power: (action: string, delay?: number) => invoke<string>('system:power', action, delay),
    volume: (level: number) => invoke<string>('system:volume', level),
    muted: (muted: boolean) => invoke<string>('system:muted', muted),
    media: (action: string) => invoke<string>('system:media', action),
    brightness: (level: number) => invoke<string>('system:brightness', level),
    screenshot: (question?: string) => invoke<{ file?: string; text?: string }>('system:screenshot', question),
    clipboardRead: () => invoke<string>('system:clipboard-read'),
    clipboardWrite: (text: string) => invoke<void>('system:clipboard-write', text),
    openPath: (target: string) => invoke<string>('system:open-path', target),
    openUrl: (url: string) => invoke<string>('system:open-url', url),
    reveal: (target: string) => invoke<string>('system:reveal', target),
    apps: () => invoke<AppInfo[]>('system:apps'),
    running: () => invoke<RunningProcess[]>('system:running'),
    openApp: (name: string) => invoke<string>('system:open-app', name),
    closeApp: (name: string) => invoke<string>('system:close-app', name),
    notify: (title: string, body: string) => invoke<void>('system:notify', title, body),
  },

  /* ------------------------------- Veriler ----------------------------- */
  data: {
    projects: () => invoke<Project[]>('data:projects'),
    createProject: (input: { name: string; description?: string }) => invoke<Project>('data:project-create', input),
    updateProject: (id: string, patch: Partial<Project>) => invoke<Project | null>('data:project-update', id, patch),
    deleteProject: (id: string) => invoke<void>('data:project-delete', id),
    tasks: () => invoke<TaskItem[]>('data:tasks'),
    addTask: (input: { title: string; detail?: string; priority?: TaskItem['priority'] }) => invoke<TaskItem>('data:task-add', input),
    toggleTask: (id: string, done?: boolean) => invoke<TaskItem | null>('data:task-toggle', id, done),
    deleteTask: (id: string) => invoke<void>('data:task-delete', id),
    reminders: () => invoke<Reminder[]>('data:reminders'),
    addReminder: (input: { text: string; at?: number; dailyAt?: string }) => invoke<Reminder>('data:reminder-add', input),
    deleteReminder: (id: string) => invoke<void>('data:reminder-delete', id),
    memories: () => invoke<MemoryEntry[]>('data:memories'),
    addMemory: (text: string, tags?: string[]) => invoke<MemoryEntry>('data:memory-add', text, tags),
    deleteMemory: (id: string) => invoke<void>('data:memory-delete', id),
    files: () => invoke<FileRecord[]>('data:files'),
    deleteFile: (id: string) => invoke<void>('data:file-delete', id),
    agendaLatest: () => invoke<AgendaDigest | null>('data:agenda-latest'),
    agendaRun: (speak?: boolean) => invoke<AgendaDigest>('data:agenda-run', speak),
    agendaHistory: () => invoke<AgendaDigest[]>('data:agenda-history'),
    audit: (limit?: number) => invoke<AuditEntry[]>('data:audit', limit),
    delegations: () => invoke<DelegationRecord[]>('data:delegations'),
    tools: () => invoke<{ name: string; label: string; description: string; risk: string; icon: string; capability: string }[]>('data:tools'),
    agents: () => invoke<{ name: string; emoji: string; tagline: string; tools: string[] }[]>('data:agents'),
    backup: () => invoke<string | null>('data:backup'),
    restore: () => invoke<string | null>('data:restore'),
    reset: () => invoke<void>('data:reset'),
    getCredentialNames: () => invoke<{ id: string; name: string; username: string; app?: string }[]>('data:credentials'),
    saveCredential: (input: { name: string; username: string; password: string; app?: string }) => invoke<unknown>('data:credential-save', input),
    deleteCredential: (name: string) => invoke<boolean>('data:credential-delete', name),
  },

  /* ------------------------------ Dosyalar ----------------------------- */
  files: {
    pick: () => invoke<Attachment[]>('files:pick'),
    pickFolder: () => invoke<string | null>('files:pick-folder'),
    saveText: (suggestedName: string, content: string) => invoke<string | null>('files:save-text', suggestedName, content),
    stat: (target: string) => invoke<{ path: string; exists: boolean; isDir: boolean; size: number }>('files:stat', target),
    home: () => invoke<{ home: string; documents: string; desktop: string; downloads: string }>('files:home'),
  },

  /* -------------------------------- Pencere ---------------------------- */
  window: {
    minimize: () => invoke<void>('window:minimize'),
    maximize: () => invoke<void>('window:maximize'),
    close: () => invoke<void>('window:close'),
    isMaximized: () => invoke<boolean>('window:is-maximized'),
    setAlwaysOnTop: (value: boolean) => invoke<void>('window:always-on-top', value),
    show: () => invoke<void>('window:show'),
  },

  /* ------------------------------- Onaylar ----------------------------- */
  confirm: {
    respond: (id: string, approved: boolean) => invoke<void>('confirm:respond', id, approved),
  },

  /* -------------------------------- Olaylar ---------------------------- */
  onEvent: (cb: (event: ChatEvent) => void) => subscribe<ChatEvent>('falcon:event', cb),
  onConfirm: (cb: (request: ToolConfirmation) => void) => subscribe<ToolConfirmation>('falcon:confirm', cb),
  onConfirmResolved: (cb: (payload: { id: string; approved: boolean }) => void) =>
    subscribe<{ id: string; approved: boolean }>('falcon:confirm-resolved', cb),
  onFocusMic: (cb: () => void) => subscribe<void>('falcon:focus-mic', cb),
  onNavigate: (cb: (route: string) => void) => subscribe<string>('falcon:navigate', cb),
  onEmergencyStop: (cb: () => void) => subscribe<void>('falcon:emergency-stop', cb),

  app: {
    version: () => invoke<string>('app:version'),
    platform: () => invoke<NodeJS.Platform>('app:platform'),
    logs: () => invoke<string>('app:logs'),
    openLogsFolder: () => invoke<void>('app:open-logs'),
    restart: () => invoke<void>('app:restart'),
    quit: () => invoke<void>('app:quit'),
  },
};

export type FalconApi = typeof api;

contextBridge.exposeInMainWorld('falcon', api);
