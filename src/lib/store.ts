import { create } from 'zustand';
import { api } from './api';
import type {
  AgendaDigest,
  AgentState,
  Attachment,
  AuditEntry,
  ChatEvent,
  ChatMessage,
  Config,
  Conversation,
  FileRecord,
  MemoryEntry,
  ModelInfo,
  Project,
  Reminder,
  SystemInfo,
  TaskItem,
  ToolConfirmation,
} from '../../shared/types';

export type View = 'chat' | 'projects' | 'files' | 'voice' | 'tools' | 'settings';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  title: string;
  body?: string;
}

export interface VoiceRuntime {
  listening: boolean;
  transcribing: boolean;
  speaking: boolean;
  level: number;
  transcript: string;
  error?: string;
  mode: 'push' | 'continuous';
}

export interface ToolMeta {
  name: string;
  label: string;
  description: string;
  risk: string;
  icon: string;
  capability: string;
}

export interface AgentMeta {
  name: string;
  emoji: string;
  tagline: string;
  tools: string[];
}

interface Store {
  ready: boolean;
  config: Config | null;
  view: View;
  conversations: Conversation[];
  activeId: string | null;
  messages: ChatMessage[];
  agentState: AgentState;
  busy: boolean;
  toasts: Toast[];
  confirm: ToolConfirmation | null;
  agenda: AgendaDigest | null;
  projects: Project[];
  tasks: TaskItem[];
  reminders: Reminder[];
  files: FileRecord[];
  memories: MemoryEntry[];
  systemInfo: SystemInfo | null;
  tools: ToolMeta[];
  agents: AgentMeta[];
  audit: AuditEntry[];
  credentials: { id: string; name: string; username: string; app?: string }[];
  models: ModelInfo[];
  voice: VoiceRuntime;
  voicePanelOpen: boolean;
  settingsTab: string;
  draft: string;
  attachments: Attachment[];

  init: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshAgenda: () => Promise<void>;
  refreshMemories: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  refreshAudit: () => Promise<void>;
  refreshCredentials: () => Promise<void>;
  refreshModels: () => Promise<void>;

  setView: (view: View) => void;
  setSettingsTab: (tab: string) => void;
  setDraft: (text: string) => void;
  addAttachments: (items: Attachment[]) => void;
  removeAttachment: (id: string) => void;

  selectConversation: (id: string | null) => Promise<void>;
  newChat: () => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  send: (text?: string, opts?: { voice?: boolean; attachments?: Attachment[] }) => Promise<void>;
  stop: () => Promise<void>;

  applyEvent: (event: ChatEvent) => void;
  setConfirm: (confirm: ToolConfirmation | null) => void;
  respondConfirm: (approved: boolean) => Promise<void>;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;

  saveConfig: (patch: Partial<Config>) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  testConnection: () => Promise<void>;
  setVoice: (patch: Partial<VoiceRuntime>) => void;
  setVoicePanelOpen: (open: boolean) => void;

  addTask: (title: string) => Promise<void>;
  toggleTask: (id: string, done: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addReminder: (text: string, at?: number, dailyAt?: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  createProject: (name: string, description: string) => Promise<void>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  removeFile: (id: string) => Promise<void>;
  runAgenda: (speak?: boolean) => Promise<void>;
}

const upsertMessage = (list: ChatMessage[], message: ChatMessage): ChatMessage[] => {
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = message;
    return copy;
  }
  return [...list, message];
};

export const useStore = create<Store>((set, get) => ({
  ready: false,
  config: null,
  view: 'chat',
  conversations: [],
  activeId: null,
  messages: [],
  agentState: { status: 'idle' },
  busy: false,
  toasts: [],
  confirm: null,
  agenda: null,
  projects: [],
  tasks: [],
  reminders: [],
  files: [],
  memories: [],
  systemInfo: null,
  tools: [],
  agents: [],
  audit: [],
  credentials: [],
  models: [],
  voice: { listening: false, transcribing: false, speaking: false, level: 0, transcript: '', mode: 'push' },
  voicePanelOpen: false,
  settingsTab: 'general',
  draft: '',
  attachments: [],

  init: async () => {
    const config = await api.config.get();
    const [conversations, projects, tasks, reminders, files, memories, tools, agents, agenda, credentials] = await Promise.all([
      api.chat.list(),
      api.data.projects(),
      api.data.tasks(),
      api.data.reminders(),
      api.data.files(),
      api.data.memories(),
      api.data.tools(),
      api.data.agents(),
      api.data.agendaLatest(),
      api.data.getCredentialNames(),
    ]);
    const active = conversations[0]?.id ?? null;
    const messages = active ? await api.chat.messages(active) : [];
    set({
      config,
      conversations,
      activeId: active,
      messages,
      projects,
      tasks,
      reminders,
      files,
      memories,
      tools,
      agents,
      agenda,
      credentials,
      ready: true,
    });
    void get().refreshSystem();
    void get().refreshAudit();
    if (config.hasApiKey) void get().refreshModels();
  },

  refreshAll: async () => {
    await Promise.all([
      get().refreshProjects(),
      get().refreshTasks(),
      get().refreshFiles(),
      get().refreshAgenda(),
      get().refreshMemories(),
      get().refreshSystem(),
      get().refreshAudit(),
      get().refreshCredentials(),
    ]);
  },

  refreshProjects: async () => set({ projects: await api.data.projects() }),
  refreshTasks: async () => set({ tasks: await api.data.tasks() }),
  refreshFiles: async () => set({ files: await api.data.files() }),
  refreshAgenda: async () => set({ agenda: await api.data.agendaLatest() }),
  refreshMemories: async () => set({ memories: await api.data.memories() }),
  refreshSystem: async () => {
    try {
      set({ systemInfo: await api.system.info() });
    } catch {
      /* demo */
    }
  },
  refreshAudit: async () => {
    try {
      set({ audit: await api.data.audit(120) });
    } catch {
      /* demo */
    }
  },
  refreshCredentials: async () => set({ credentials: await api.data.getCredentialNames() }),
  refreshModels: async () => {
    try {
      set({ models: await api.config.models(false) });
    } catch {
      set({ models: [] });
    }
  },

  setView: (view) => set({ view }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setDraft: (draft) => set({ draft }),
  addAttachments: (items) => set((s) => ({ attachments: [...s.attachments, ...items].slice(0, 8) })),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  selectConversation: async (id) => {
    if (!id) {
      set({ activeId: null, messages: [], view: 'chat' });
      return;
    }
    const messages = await api.chat.messages(id);
    set({ activeId: id, messages, view: 'chat' });
  },

  newChat: async () => {
    const conv = await api.chat['new']('Yeni sohbet');
    const conversations = [conv, ...get().conversations.filter((c) => c.id !== conv.id)];
    set({ conversations, activeId: conv.id, messages: [], view: 'chat', draft: '', attachments: [] });
  },

  deleteChat: async (id) => {
    await api.chat.remove(id);
    const conversations = get().conversations.filter((c) => c.id !== id);
    const nextActive = get().activeId === id ? (conversations[0]?.id ?? null) : get().activeId;
    const messages = nextActive ? await api.chat.messages(nextActive) : [];
    set({ conversations, activeId: nextActive, messages });
  },

  send: async (text, opts) => {
    const content = (text ?? get().draft).trim();
    const attachments = opts?.attachments ?? get().attachments;
    if ((!content && attachments.length === 0) || get().busy) return;
    const wasVoice = Boolean(opts?.voice);
    set({ draft: '', attachments: [], busy: true });
    try {
      await api.chat.send({
        text: content,
        conversationId: get().activeId ?? undefined,
        attachments,
        voice: wasVoice,
      });
    } catch (err) {
      get().pushToast({
        kind: 'error',
        title: 'İstek gönderilemedi',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      set({ busy: false });
      void get().refreshProjects();
    }
  },

  stop: async () => {
    await api.chat.stop();
    set({ busy: false, agentState: { status: 'idle' } });
    get().pushToast({ kind: 'info', title: 'Durduruldu', body: 'Falcon beklemeye alındı.' });
  },

  applyEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'message': {
        const msg = event.message;
        const conversations = state.conversations.map((c) =>
          c.id === msg.conversationId
            ? { ...c, updatedAt: Date.now(), title: c.title === 'Yeni sohbet' && msg.role === 'user' ? msg.text.slice(0, 48) : c.title }
            : c,
        );
        if (!conversations.some((c) => c.id === msg.conversationId)) {
          void api.chat.list().then((list) => set({ conversations: list }));
        } else {
          set({ conversations });
        }
        if (msg.conversationId === state.activeId || !state.activeId) {
          set({ messages: upsertMessage(state.messages, msg), activeId: msg.conversationId });
        }
        break;
      }
      case 'delta': {
        if (event.conversationId !== state.activeId) return;
        const existing = state.messages.find((m) => m.id === event.messageId);
        if (existing) {
          set({
            messages: state.messages.map((m) => (m.id === event.messageId ? { ...m, text: event.text } : m)),
          });
        } else {
          set({
            messages: [
              ...state.messages,
              {
                id: event.messageId,
                conversationId: event.conversationId,
                role: 'assistant',
                text: event.text,
                createdAt: Date.now(),
              },
            ],
          });
        }
        break;
      }
      case 'state':
        set({
          agentState: event.state,
          busy: event.state.status === 'thinking' || event.state.status === 'tool',
        });
        break;
      case 'conversation':
        set({
          conversations: state.conversations.some((c) => c.id === event.conversation.id)
            ? state.conversations.map((c) => (c.id === event.conversation.id ? event.conversation : c))
            : [event.conversation, ...state.conversations],
        });
        break;
      case 'toast':
        get().pushToast({ kind: event.kind, title: event.title, body: event.body });
        break;
      case 'config':
        set({ config: event.config });
        break;
      case 'agenda':
        set({ agenda: event.digest });
        break;
      case 'confirm':
        set({ confirm: event.request });
        break;
      case 'confirm-resolved':
        if (state.confirm?.id === event.id) set({ confirm: null });
        break;
      case 'speak':
        window.dispatchEvent(new CustomEvent('falcon:speak', { detail: event.text }));
        break;
    }
  },

  setConfirm: (confirm) => set({ confirm }),

  respondConfirm: async (approved) => {
    const confirm = get().confirm;
    if (!confirm) return;
    await api.confirm.respond(confirm.id, approved);
    set({ confirm: null });
  },

  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? 7000 : 4500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  saveConfig: async (patch) => {
    const config = await api.config.update(patch);
    set({ config });
    if (patch.permissions?.mode) {
      get().pushToast({ kind: 'info', title: 'İzin modu güncellendi' });
    }
  },

  setApiKey: async (key) => {
    const config = await api.config.setApiKey(key);
    set({ config });
    await get().testConnection();
  },

  testConnection: async () => {
    const result = await api.config.test();
    if (result.ok) {
      set({ models: result.models ?? get().models });
      get().pushToast({
        kind: 'success',
        title: 'Bağlantı başarılı',
        body: result.model ? `${result.model} · ${result.latencyMs ?? 0} ms` : result.message,
      });
      void get().refreshModels();
    } else {
      get().pushToast({ kind: 'error', title: 'Bağlantı kurulamadı', body: result.message });
    }
  },

  setVoice: (patch) => set((s) => ({ voice: { ...s.voice, ...patch } })),
  setVoicePanelOpen: (voicePanelOpen) => set({ voicePanelOpen }),

  addTask: async (title) => {
    await api.data.addTask({ title });
    await get().refreshTasks();
  },
  toggleTask: async (id, done) => {
    await api.data.toggleTask(id, done);
    await get().refreshTasks();
  },
  deleteTask: async (id) => {
    await api.data.deleteTask(id);
    await get().refreshTasks();
  },
  addReminder: async (text, at, dailyAt) => {
    await api.data.addReminder({ text, at, dailyAt });
    set({ reminders: await api.data.reminders() });
  },
  deleteReminder: async (id) => {
    await api.data.deleteReminder(id);
    set({ reminders: await api.data.reminders() });
  },
  addMemory: async (text) => {
    await api.data.addMemory(text, []);
    await get().refreshMemories();
  },
  deleteMemory: async (id) => {
    await api.data.deleteMemory(id);
    await get().refreshMemories();
  },
  createProject: async (name, description) => {
    await api.data.createProject({ name, description });
    await get().refreshProjects();
  },
  updateProject: async (id, patch) => {
    await api.data.updateProject(id, patch);
    await get().refreshProjects();
  },
  deleteProject: async (id) => {
    await api.data.deleteProject(id);
    await get().refreshProjects();
  },
  removeFile: async (id) => {
    await api.data.deleteFile(id);
    await get().refreshFiles();
  },
  runAgenda: async (speak = true) => {
    get().pushToast({ kind: 'info', title: 'Gündem toplanıyor', body: 'Google Arama ile son 24 saat taranıyor…' });
    try {
      const digest = await api.data.agendaRun(speak);
      set({ agenda: digest });
    } catch (err) {
      get().pushToast({ kind: 'error', title: 'Gündem alınamadı', body: err instanceof Error ? err.message : String(err) });
    }
  },
}));

export const useConfig = () => useStore((s) => s.config);
export const useVoice = () => useStore((s) => s.voice);
