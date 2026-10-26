/**
 * Falcon — ana süreç (Electron) ve arayüz arasında paylaşılan tipler.
 * Tek bir doğruluk kaynağı: hem `electron/` hem `src/` bu dosyayı kullanır.
 */

export type PermissionMode = 'manual' | 'smart' | 'full';

/** Yapay zekâ sağlayıcıları. Gemini zorunlu değildir; herhangi biri yeterlidir. */
export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'nvidia' | 'abacus';

export type ProviderKind = 'gemini' | 'openai' | 'anthropic';

/** Ayarlarda saklanan sağlayıcı girdisi (anahtar şifreli). */
export interface ProviderEntry {
  /** safeStorage ile şifrelenmiş anahtar (Gemini anahtarı `apiKeyEncrypted` alanında tutulur) */
  keyEncrypted: string | null;
  /** Sohbet/araç modeli; boşsa sağlayıcının varsayılanı kullanılır */
  model: string;
  /** Gelişmiş: özel API kök adresi (boşsa sağlayıcının resmî adresi) */
  baseUrl: string;
}

export interface AiSettings {
  /** Sohbet ve araç kullanımında birincil sağlayıcı */
  primary: ProviderId;
  /** Birincil sağlayıcı çalışmazsa anahtarı olan diğer sağlayıcıya geç */
  fallback: boolean;
  /** Seslendirme (TTS) ve yazıya dökme (STT) sağlayıcısı */
  voiceProvider: 'gemini' | 'openai';
  openaiSttModel: string;
  openaiTtsModel: string;
  openaiVoice: string;
  providers: Record<Exclude<ProviderId, 'gemini'>, ProviderEntry>;
}

/** Arayüze gönderilen sağlayıcı durumu (anahtar asla gönderilmez). */
export interface ProviderState {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  hasKey: boolean;
  masked: string;
  model: string;
  defaultModel: string;
  baseUrl: string;
  docsUrl: string;
  keyHint: string;
  supportsVoice: boolean;
  supportsVision: boolean;
  note: string;
}
export type Platform = 'win32' | 'darwin' | 'linux';

export interface ModelSettings {
  /** Ana akıl yürütme / ajan beyni */
  brain: string;
  /** Hızlı işler: başlık, sınıflandırma, gündem özeti */
  fast: string;
  /** Görsel ve belge analizi */
  vision: string;
  /** Metinden sese */
  tts: string;
  /** Sesten metne */
  stt: string;
  /** Web araması (grounding) */
  search: string;
  temperature: number;
  maxOutputTokens: number;
  /** Model bulunamazsa otomatik yedek modele geç */
  autoFallback: boolean;
}

export interface VoiceSettings {
  engine: 'gemini' | 'system' | 'off';
  /** Gemini prebuilt ses adı: Kore, Puck, Charon, Zephyr, Fenrir... */
  voice: string;
  /** Ses tonu yönergesi (Türkçe, sıcak, enerjik...) */
  style: string;
  autoSpeak: boolean;
  continuousListening: boolean;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  /** System engine için SpeechSynthesis voiceURI */
  systemVoiceURI: string;
  rate: number;
  micDeviceId: string;
  vadSilenceMs: number;
  vadThreshold: number;
}

export interface PermissionSettings {
  mode: PermissionMode;
  fileAccess: boolean;
  appControl: boolean;
  microphone: boolean;
  camera: boolean;
  power: boolean;
  terminal: boolean;
  network: boolean;
  clipboard: boolean;
  /** Yıkıcı işlemlerde ek onay iste */
  confirmDelete: boolean;
  confirmTerminal: boolean;
  confirmPower: boolean;
  /** Erişilebilecek kök klasörler. Boşsa kullanıcı ev dizini kullanılır. */
  allowedRoots: string[];
  /** Asla çalıştırılmayacak komut kalıpları (regex) */
  blockedCommands: string[];
}

export interface GeneralSettings {
  launchAtLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  globalShortcut: string;
  emergencyShortcut: string;
  alwaysOnTop: boolean;
  telemetry: false;
}

export interface AgendaSettings {
  enabled: boolean;
  /** 24 saat formatı: "09:00" */
  time: string;
  topics: string[];
  speak: boolean;
  lastDigestAt?: number;
}

export interface Config {
  version: number;
  userName: string;
  /** safeStorage ile şifrelenmiş API anahtarı (base64) */
  apiKeyEncrypted: string | null;
  hasApiKey: boolean;
  onboardingDone: boolean;
  general: GeneralSettings;
  models: ModelSettings;
  voice: VoiceSettings;
  permissions: PermissionSettings;
  agenda: AgendaSettings;
  ai: AiSettings;
  /** Yalnızca arayüz için: publicConfig() doldurur, diske yazılmaz. */
  providerStates?: ProviderState[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  methods: string[];
}

export interface ApiTestResult {
  ok: boolean;
  message: string;
  model?: string;
  latencyMs?: number;
  models?: ModelInfo[];
}

/* ------------------------------------------------------------------ */
/* Sohbet                                                              */
/* ------------------------------------------------------------------ */

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'diary';
export type ToolStatus = 'running' | 'ok' | 'error' | 'denied';
export type AgentName = 'Falcon' | 'Araştırmacı' | 'Kodcu' | 'Analist' | 'Planlayıcı' | 'Gündem';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Diskteki yol (varsa) */
  path?: string;
  /** Küçük dosyalar için data URL (görsel önizleme) */
  dataUrl?: string;
  /** Gemini'a gönderilecek base64 içerik (main süreçte doldurulur) */
  base64?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  output?: string;
  detail?: string;
  risk?: ToolRisk;
  agent?: AgentName;
  startedAt: number;
  endedAt?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  agent?: AgentName;
  attachments?: Attachment[];
  tool?: ToolCallInfo;
  error?: string;
  /** Sesli yanıt üretildi mi */
  spoken?: boolean;
  sources?: { title: string; uri: string }[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type ToolRisk = 'safe' | 'moderate' | 'dangerous';

export interface ToolConfirmation {
  id: string;
  title: string;
  detail: string;
  tool: string;
  risk: ToolRisk;
  agent: AgentName;
  createdAt: number;
  timeoutMs: number;
}

export interface AgentState {
  status: 'idle' | 'thinking' | 'tool' | 'speaking' | 'listening' | 'paused';
  activeTool?: string;
  activeAgent?: AgentName;
  conversationId?: string;
  /** Acil durdurma aktif mi */
  stopped?: boolean;
}

/* ------------------------------------------------------------------ */
/* Olaylar (main → renderer)                                           */
/* ------------------------------------------------------------------ */

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; messageId: string; text: string; conversationId: string }
  | { type: 'state'; state: AgentState }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'toast'; kind: 'info' | 'success' | 'error'; title: string; body?: string }
  | { type: 'config'; config: Config }
  | { type: 'agenda'; digest: AgendaDigest }
  | { type: 'speak'; text: string; messageId?: string }
  | { type: 'confirm'; request: ToolConfirmation }
  | { type: 'confirm-resolved'; id: string; approved: boolean };

/* ------------------------------------------------------------------ */
/* Veri modelleri                                                      */
/* ------------------------------------------------------------------ */

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color?: string;
  files: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  conversationId?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  detail?: string;
  done: boolean;
  priority: 'low' | 'normal' | 'high';
  dueAt?: number;
  projectId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Reminder {
  id: string;
  text: string;
  /** epoch ms — bir kerelik */
  at?: number;
  /** günlük tekrar "HH:mm" */
  dailyAt?: string;
  enabled: boolean;
  createdAt: number;
  lastFiredAt?: number;
  spoken?: boolean;
}

export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  source?: 'user' | 'agent';
}

export interface FileRecord {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  addedAt: number;
  lastAnalyzedAt?: number;
  summary?: string;
  projectId?: string;
}

export interface AgendaItem {
  title: string;
  summary: string;
  category: string;
  source?: { title: string; uri: string };
}

export interface AgendaDigest {
  id: string;
  createdAt: number;
  topics: string[];
  headline: string;
  items: AgendaItem[];
  raw?: string;
  spoken?: boolean;
}

export interface AuditEntry {
  id: string;
  at: number;
  tool: string;
  args: Record<string, unknown>;
  outcome: 'ok' | 'error' | 'denied' | 'blocked';
  summary: string;
  agent: AgentName;
  durationMs: number;
}

export interface DelegationRecord {
  id: string;
  agent: AgentName;
  task: string;
  result: string;
  ok: boolean;
  createdAt: number;
  durationMs: number;
  conversationId?: string;
}

export interface SystemInfo {
  platform: Platform;
  platformLabel: string;
  hostname: string;
  user: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  totalMemGb: number;
  freeMemGb: number;
  memUsedPct: number;
  uptimeSec: number;
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  battery?: { percent: number; charging: boolean } | null;
  displays: { width: number; height: number; primary: boolean; scaleFactor: number }[];
  volumes: { name: string; mount: string; totalGb: number; freeGb: number }[];
}

export interface AppInfo {
  name: string;
  id?: string;
  path?: string;
  running?: boolean;
}

export interface RunningProcess {
  pid: number;
  name: string;
  cpu?: number;
  mem?: number;
}

export interface ToolMeta {
  name: string;
  label: string;
  description: string;
  risk: ToolRisk;
  capability: keyof PermissionSettings | 'core';
  icon: string;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  /** Modelin görmesi için ek metin (ör. uzun dosya içeriği) */
  content?: string;
}

export interface ChatRequest {
  text: string;
  conversationId?: string;
  attachments?: Attachment[];
  /** Sesli mod: yanıt otomatik seslendirilir */
  voice?: boolean;
  /** Alt ajan çalıştırması (iç kullanım) */
  agent?: AgentName;
}

export const DEFAULT_CONFIG: Config = {
  version: 2,
  userName: 'Kullanıcı',
  apiKeyEncrypted: null,
  hasApiKey: false,
  onboardingDone: false,
  general: {
    launchAtLogin: false,
    startMinimized: false,
    closeToTray: true,
    globalShortcut: 'CommandOrControl+Alt+Space',
    emergencyShortcut: 'CommandOrControl+Alt+F',
    alwaysOnTop: false,
    telemetry: false,
  },
  models: {
    brain: 'gemini-3.8-flash',
    fast: 'gemini-3.5-flash-lite',
    vision: 'gemini-3.8-flash',
    tts: 'gemini-3.8-flash-tts',
    stt: 'gemini-3.8-flash',
    search: 'gemini-3.8-flash',
    temperature: 0.7,
    maxOutputTokens: 8192,
    autoFallback: true,
  },
  voice: {
    engine: 'gemini',
    voice: 'Kore',
    style: 'sıcak, kendinden emin ve doğal; Türkçe akıcı konuşan bir kişisel asistan',
    autoSpeak: true,
    continuousListening: false,
    wakeWordEnabled: false,
    wakePhrase: 'Falcon',
    systemVoiceURI: '',
    rate: 1,
    micDeviceId: '',
    vadSilenceMs: 1100,
    vadThreshold: 0.035,
  },
  permissions: {
    mode: 'full',
    fileAccess: true,
    appControl: true,
    microphone: true,
    camera: false,
    power: true,
    terminal: true,
    network: true,
    clipboard: true,
    confirmDelete: false,
    confirmTerminal: false,
    confirmPower: false,
    allowedRoots: [],
    blockedCommands: [
      'rm\\s+-rf\\s+/(\\s|$)',
      'format\\s+[a-z]:',
      'mkfs',
      'diskpart\\s+clean',
      'vssadmin\\s+delete',
      'bcdedit',
      ':(){',
      'shutdown\\s+/f\\s+/t\\s+0\\s+/r\\s+/f',
    ],
  },
  agenda: {
    enabled: false,
    time: '09:00',
    topics: ['Türkiye gündemi', 'Dünya', 'Teknoloji', 'Ekonomi'],
    speak: true,
  },
  ai: {
    primary: 'gemini',
    fallback: true,
    voiceProvider: 'gemini',
    openaiSttModel: 'whisper-1',
    openaiTtsModel: 'gpt-4o-mini-tts',
    openaiVoice: 'nova',
    providers: {
      openai: { keyEncrypted: null, model: '', baseUrl: '' },
      anthropic: { keyEncrypted: null, model: '', baseUrl: '' },
      nvidia: { keyEncrypted: null, model: '', baseUrl: '' },
      abacus: { keyEncrypted: null, model: '', baseUrl: '' },
    },
  },
  createdAt: 0,
  updatedAt: 0,
};
