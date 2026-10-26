import {
  DEFAULT_CONFIG,
  type AgendaDigest,
  type ApiTestResult,
  type AppInfo,
  type Attachment,
  type AuditEntry,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type Config,
  type Conversation,
  type DelegationRecord,
  type FileRecord,
  type MemoryEntry,
  type ModelInfo,
  type Project,
  type Reminder,
  type RunningProcess,
  type SystemInfo,
  type TaskItem,
  type ToolConfirmation,
} from '../../shared/types';
import TOOL_CATALOG from '../../shared/tool-catalog.json';

/**
 * Arayüz ↔ ana süreç köprüsü.
 * Electron içinde preload tarafından sağlanan gerçek API kullanılır. Tarayıcıda
 * (tasarım önizlemesi / `npm run dev` Vite) API yoksa, arayüzün çalışmaya devam
 * etmesi için örnek veri üreten bir demo katmanı devreye girer.
 */

export interface FalconApi {
  config: {
    get(): Promise<Config>;
    update(patch: Partial<Config>): Promise<Config>;
    setApiKey(key: string): Promise<Config>;
    maskedKey(): Promise<string>;
    test(): Promise<ApiTestResult>;
    models(force?: boolean): Promise<ModelInfo[]>;
    reset(): Promise<Config>;
  };
  chat: {
    send(request: ChatRequest): Promise<{ conversationId: string; assistantMessage: ChatMessage; spokenText: string }>;
    stop(): Promise<void>;
    list(): Promise<Conversation[]>;
    messages(id: string): Promise<ChatMessage[]>;
    'new'(title?: string): Promise<Conversation>;
    remove(id: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    clear(): Promise<void>;
    export(id: string): Promise<string | null>;
  };
  voice: {
    speak(text: string, voice?: string): Promise<{ audioBase64: string; mime: string; model: string; chars: number; chunks: number }>;
    transcribe(audioBase64: string, mime: string, hint?: string): Promise<{ text: string }>;
    askMicPermission(): Promise<boolean>;
  };
  system: {
    info(): Promise<SystemInfo>;
    power(action: string, delay?: number): Promise<string>;
    volume(level: number): Promise<string>;
    muted(muted: boolean): Promise<string>;
    media(action: string): Promise<string>;
    brightness(level: number): Promise<string>;
    screenshot(question?: string): Promise<{ file?: string; text?: string }>;
    clipboardRead(): Promise<string>;
    clipboardWrite(text: string): Promise<void>;
    openPath(target: string): Promise<string>;
    openUrl(url: string): Promise<string>;
    reveal(target: string): Promise<string>;
    apps(): Promise<AppInfo[]>;
    running(): Promise<RunningProcess[]>;
    openApp(name: string): Promise<string>;
    closeApp(name: string): Promise<string>;
    notify(title: string, body: string): Promise<void>;
  };
  data: {
    projects(): Promise<Project[]>;
    createProject(input: { name: string; description?: string }): Promise<Project>;
    updateProject(id: string, patch: Partial<Project>): Promise<Project | null>;
    deleteProject(id: string): Promise<void>;
    tasks(): Promise<TaskItem[]>;
    addTask(input: { title: string; detail?: string; priority?: TaskItem['priority'] }): Promise<TaskItem>;
    toggleTask(id: string, done?: boolean): Promise<TaskItem | null>;
    deleteTask(id: string): Promise<void>;
    reminders(): Promise<Reminder[]>;
    addReminder(input: { text: string; at?: number; dailyAt?: string }): Promise<Reminder>;
    deleteReminder(id: string): Promise<void>;
    memories(): Promise<MemoryEntry[]>;
    addMemory(text: string, tags?: string[]): Promise<MemoryEntry>;
    deleteMemory(id: string): Promise<void>;
    files(): Promise<FileRecord[]>;
    deleteFile(id: string): Promise<void>;
    agendaLatest(): Promise<AgendaDigest | null>;
    agendaRun(speak?: boolean): Promise<AgendaDigest>;
    agendaHistory(): Promise<AgendaDigest[]>;
    audit(limit?: number): Promise<AuditEntry[]>;
    delegations(): Promise<DelegationRecord[]>;
    tools(): Promise<{ name: string; label: string; description: string; risk: string; icon: string; capability: string }[]>;
    agents(): Promise<{ name: string; emoji: string; tagline: string; tools: string[] }[]>;
    backup(): Promise<string | null>;
    restore(): Promise<string | null>;
    reset(): Promise<void>;
    getCredentialNames(): Promise<{ id: string; name: string; username: string; app?: string }[]>;
    saveCredential(input: { name: string; username: string; password: string; app?: string }): Promise<unknown>;
    deleteCredential(name: string): Promise<boolean>;
  };
  files: {
    pick(): Promise<Attachment[]>;
    pickFolder(): Promise<string | null>;
    saveText(suggestedName: string, content: string): Promise<string | null>;
    stat(target: string): Promise<{ path: string; exists: boolean; isDir: boolean; size: number }>;
    home(): Promise<{ home: string; documents: string; desktop: string; downloads: string }>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    setAlwaysOnTop(value: boolean): Promise<void>;
    show(): Promise<void>;
  };
  confirm: { respond(id: string, approved: boolean): Promise<void> };
  onEvent(cb: (event: ChatEvent) => void): () => void;
  onConfirm(cb: (request: ToolConfirmation) => void): () => void;
  onConfirmResolved(cb: (payload: { id: string; approved: boolean }) => void): () => void;
  onFocusMic(cb: () => void): () => void;
  onNavigate(cb: (route: string) => void): () => void;
  onEmergencyStop(cb: () => void): () => void;
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
    logs(): Promise<string>;
    openLogsFolder(): Promise<void>;
    restart(): Promise<void>;
    quit(): Promise<void>;
  };
}

const electronApi = (globalThis as { falcon?: FalconApi }).falcon;
export const isElectron = Boolean(electronApi);

/* ------------------------------------------------------------------ */
/* Tarayıcı demo katmanı                                               */
/* ------------------------------------------------------------------ */

const now = Date.now();
const uid = (p = '') => `${p}${Math.random().toString(36).slice(2, 9)}`;

const demoProjects: Project[] = [
  { id: 'p1', name: 'DersAI', description: 'Eğitim / Notlar', icon: 'book', files: [], createdAt: now - 86400000 * 4, updatedAt: now - 7200000, lastOpenedAt: now - 7200000 },
  { id: 'p2', name: 'YKS Planı', description: 'Planlama', icon: 'calendar', files: [], createdAt: now - 86400000 * 8, updatedAt: now - 18000000, lastOpenedAt: now - 18000000 },
  { id: 'p3', name: 'Minceraft Mod', description: 'Oyun Geliştirme', icon: 'gamepad', files: [], createdAt: now - 86400000 * 12, updatedAt: now - 86400000, lastOpenedAt: now - 86400000 },
  { id: 'p4', name: 'Python Projeleri', description: 'Kod / Uygulamalar', icon: 'code', files: [], createdAt: now - 86400000 * 20, updatedAt: now - 86400000 * 2, lastOpenedAt: now - 86400000 * 2 },
  { id: 'p5', name: 'Notlar', description: 'Ders Notları', icon: 'note', files: [], createdAt: now - 86400000 * 26, updatedAt: now - 86400000 * 3, lastOpenedAt: now - 86400000 * 3 },
];

const demoConversation: Conversation = { id: 'c-demo', title: 'Falcon ile tanışma', createdAt: now - 600000, updatedAt: now, messageCount: 3 };

const demoMessages: ChatMessage[] = [
  {
    id: 'm1',
    conversationId: 'c-demo',
    role: 'assistant',
    text: 'Merhaba Umut! Ben Falcon. Bilgisayarında tam yetkiyle çalışıyorum: uygulama açıp kapatabilir, dosyalarını okuyup yazabilir, gündemi takip edebilir, hatta bilgisayarını kapatabilirim. Ne yapmamı istersin?',
    createdAt: now - 590000,
  },
  {
    id: 'm2',
    conversationId: 'c-demo',
    role: 'user',
    text: 'Chrome’u aç ve bugünün gündemini özetle.',
    createdAt: now - 580000,
  },
  {
    id: 'm3',
    conversationId: 'c-demo',
    role: 'tool',
    text: 'Chrome açıldı.',
    createdAt: now - 575000,
    tool: {
      id: 't1',
      name: 'open_app',
      label: 'Uygulama aç',
      args: { app: 'chrome' },
      status: 'ok',
      detail: 'Chrome açıldı.',
      output: 'chrome.exe',
      risk: 'safe',
      startedAt: now - 576000,
      endedAt: now - 575000,
    },
  },
  {
    id: 'm4',
    conversationId: 'c-demo',
    role: 'assistant',
    text: 'Chrome açıldı. Gündemin öne çıkan başlıkları:\n\n1. **Teknoloji** — Yeni nesil yapay zekâ modelleri günlük iş akışlarına giriyor.\n2. **Ekonomi** — Piyasalarda dalgalanma sürüyor, uzmanlar temkinli.\n3. **Türkiye** — Ulaşım projelerinde yeni aşama duyuruldu.\n\nAyrıntılı raporu Gündem sekmesinde bulabilirsin.',
    createdAt: now - 570000,
  },
];

const demoDigest: AgendaDigest = {
  id: 'ag-demo',
  createdAt: now - 3600000,
  topics: ['Türkiye gündemi', 'Dünya', 'Teknoloji', 'Ekonomi'],
  headline: 'Yapay zekâ yatırımları hızlanırken teknoloji hisseleri yükselişte',
  items: [
    { title: 'Yeni yapay zekâ modelleri tanıtıldı', summary: 'Sektör liderleri, ajan tabanlı yeni modellerini duyurdu.', category: 'Teknoloji' },
    { title: 'Merkez Bankası faiz kararını açıkladı', summary: 'Piyasa beklentileriyle uyumlu bir karar geldi.', category: 'Ekonomi' },
    { title: 'Büyükşehirlerde ulaşım yatırımı', summary: 'Yeni metro hattı için ihale takvimi netleşti.', category: 'Türkiye' },
  ],
  spoken: false,
};

const demoInfo: SystemInfo = {
  platform: 'win32',
  platformLabel: 'Windows',
  hostname: 'FALCON-PC',
  user: 'Umut',
  osVersion: 'Windows 11 Pro 24H2',
  arch: 'x64',
  cpu: 'AMD Ryzen 7 5800H',
  cores: 16,
  totalMemGb: 32,
  freeMemGb: 18.6,
  memUsedPct: 42,
  uptimeSec: 15230,
  appVersion: '1.0.0',
  electron: '45.0.0',
  node: '22.22.3',
  chrome: '140',
  battery: { percent: 86, charging: true },
  displays: [{ width: 2560, height: 1440, primary: true, scaleFactor: 1 }],
  volumes: [{ name: 'C:', mount: 'C:\\', totalGb: 954, freeGb: 412 }],
};

function createDemoApi(): FalconApi {
  const previewOnboarding =
    typeof location !== 'undefined' && /[?&]onboarding=1/.test(location.search);
  let config: Config = {
    ...structuredClone(DEFAULT_CONFIG),
    userName: 'Umut',
    hasApiKey: !previewOnboarding,
    onboardingDone: !previewOnboarding,
    createdAt: now,
    updatedAt: now,
  };
  const listeners = new Set<(e: ChatEvent) => void>();
  const confirmListeners = new Set<(r: ToolConfirmation) => void>();
  const conversations = [demoConversation];
  const messages: Record<string, ChatMessage[]> = { 'c-demo': [...demoMessages] };
  let projects = [...demoProjects];
  let tasks: TaskItem[] = [
    { id: 't1', title: 'Matematik denemesini bitir', done: false, priority: 'high', createdAt: now - 200000 },
    { id: 't2', title: 'Falcon için API anahtarını yenile', done: false, priority: 'normal', createdAt: now - 500000 },
    { id: 't3', title: 'Proje sunumunu hazırla', done: true, priority: 'normal', createdAt: now - 900000, completedAt: now - 300000 },
  ];
  let files: FileRecord[] = [
    { id: 'f1', name: 'Eğitim Notları.pdf', path: 'C:\\Users\\Umut\\Documents\\Eğitim Notları.pdf', mime: 'application/pdf', size: 1_240_000, addedAt: now - 7200000 },
    { id: 'f2', name: 'YKS Planı.xlsx', path: 'C:\\Users\\Umut\\Documents\\YKS Planı.xlsx', mime: 'application/vnd.ms-excel', size: 48_000, addedAt: now - 20000000 },
  ];

  const emit = (event: ChatEvent) => listeners.forEach((l) => l(event));

  const demoAnswer = (text: string) =>
    `Anladım Umut. **${text.slice(0, 90)}**${text.length > 90 ? '…' : ''}\n\nBu bir tarayıcı önizlemesi: gerçek uygulamada Gemini API’si ile çalışır, araçları (uygulama açma, dosya okuma, terminal, güç işlemleri) gerçekten çalıştırır ve yanıtı Gemini sesiyle seslendirir.\n\n- Masaüstü uygulamasında tam yetki\n- Google AI Studio anahtarı yeterli\n- Tüm veriler cihazında kalır`;

  const api: FalconApi = {
    config: {
      get: async () => config,
      update: async (patch) => {
        config = {
          ...config,
          ...patch,
          general: { ...config.general, ...(patch.general ?? {}) },
          models: { ...config.models, ...(patch.models ?? {}) },
          voice: { ...config.voice, ...(patch.voice ?? {}) },
          permissions: { ...config.permissions, ...(patch.permissions ?? {}) },
          agenda: { ...config.agenda, ...(patch.agenda ?? {}) },
        };
        emit({ type: 'config', config });
        return config;
      },
      setApiKey: async (key) => {
        config = { ...config, hasApiKey: Boolean(key), onboardingDone: true };
        return config;
      },
      maskedKey: async () => 'AIza••••••••••••9f2c',
      test: async () => ({ ok: true, message: 'Demo modunda bağlantı doğrulanamaz. Masaüstü uygulamasında gerçek test yapılır.', model: config.models.brain, latencyMs: 240 }),
      models: async () => [
        { name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', description: '', inputTokenLimit: 1000000, outputTokenLimit: 65536, methods: ['generateContent'] },
        { name: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', description: '', inputTokenLimit: 1000000, outputTokenLimit: 65536, methods: ['generateContent'] },
        { name: 'gemini-3.8-flash-tts', displayName: 'Gemini 3.8 Flash TTS', description: '', inputTokenLimit: 8000, outputTokenLimit: 8000, methods: ['generateContent'] },
      ],
      reset: async () => config,
    },
    chat: {
      send: async (request) => {
        let conversationId = request.conversationId;
        if (!conversationId) {
          const conv: Conversation = { id: uid('c'), title: request.text.slice(0, 40), createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
          conversations.unshift(conv);
          messages[conv.id] = [];
          conversationId = conv.id;
          emit({ type: 'conversation', conversation: conv });
        }
        const user: ChatMessage = { id: uid('m'), conversationId, role: 'user', text: request.text, createdAt: Date.now(), attachments: request.attachments };
        messages[conversationId].push(user);
        emit({ type: 'message', message: user });
        emit({ type: 'state', state: { status: 'thinking', conversationId } });
        const id = uid('m');
        const full = demoAnswer(request.text);
        const assistant: ChatMessage = { id, conversationId, role: 'assistant', text: '', createdAt: Date.now() };
        emit({ type: 'message', message: assistant });
        await new Promise((r) => setTimeout(r, 380));
        for (let i = 0; i < full.length; i += 6) {
          await new Promise((r) => setTimeout(r, 12));
          emit({ type: 'delta', messageId: id, text: full.slice(0, i + 6), conversationId });
        }
        const final = { ...assistant, text: full };
        messages[conversationId].push(final);
        emit({ type: 'message', message: final });
        emit({ type: 'state', state: { status: 'idle', conversationId } });
        return { conversationId, assistantMessage: final, spokenText: full };
      },
      stop: async () => emit({ type: 'state', state: { status: 'idle', stopped: true } }),
      list: async () => conversations,
      messages: async (id) => messages[id] ?? [],
      'new': async (title) => {
        const conv: Conversation = { id: uid('c'), title: title ?? 'Yeni sohbet', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
        conversations.unshift(conv);
        messages[conv.id] = [];
        emit({ type: 'conversation', conversation: conv });
        return conv;
      },
      remove: async (id) => {
        const idx = conversations.findIndex((c) => c.id === id);
        if (idx >= 0) conversations.splice(idx, 1);
      },
      rename: async (id, title) => {
        const conv = conversations.find((c) => c.id === id);
        if (conv) conv.title = title;
      },
      clear: async () => {
        conversations.length = 0;
        for (const key of Object.keys(messages)) delete messages[key];
      },
      export: async () => null,
    },
    voice: {
      speak: async () => {
        throw new Error('Tarayıcı önizlemesinde Gemini sesi kullanılamıyor; sistem sesi deneniyor.');
      },
      transcribe: async () => ({ text: 'Chrome’u aç ve bugünün gündemini özetle' }),
      askMicPermission: async () => true,
    },
    system: {
      info: async () => demoInfo,
      power: async () => 'Demo modunda güç işlemi uygulanmadı.',
      volume: async (l) => `Ses %${l}`,
      muted: async (m) => (m ? 'Ses kapatıldı' : 'Ses açıldı'),
      media: async (a) => `Medya: ${a}`,
      brightness: async (l) => `Parlaklık %${l}`,
      screenshot: async () => ({ file: 'demo-ekran.png', text: 'Demo ekran görüntüsü.' }),
      clipboardRead: async () => 'Panodaki örnek metin',
      clipboardWrite: async () => undefined,
      openPath: async (p) => `Açıldı: ${p}`,
      openUrl: async (u) => `Açıldı: ${u}`,
      reveal: async (p) => `Gösterildi: ${p}`,
      apps: async () => [],
      running: async () => [],
      openApp: async (n) => `${n} açıldı (demo).`,
      closeApp: async (n) => `${n} kapatıldı (demo).`,
      notify: async () => undefined,
    },
    data: {
      projects: async () => projects,
      createProject: async (input) => {
        const project: Project = { id: uid('p'), name: input.name, description: input.description ?? '', icon: 'folder', files: [], createdAt: Date.now(), updatedAt: Date.now() };
        projects = [project, ...projects];
        return project;
      },
      updateProject: async (id, patch) => {
        projects = projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
        return projects.find((p) => p.id === id) ?? null;
      },
      deleteProject: async (id) => {
        projects = projects.filter((p) => p.id !== id);
      },
      tasks: async () => tasks,
      addTask: async (input) => {
        const task: TaskItem = { id: uid('t'), title: input.title, detail: input.detail, done: false, priority: input.priority ?? 'normal', createdAt: Date.now() };
        tasks = [...tasks, task];
        return task;
      },
      toggleTask: async (id, done) => {
        tasks = tasks.map((t) => (t.id === id ? { ...t, done: done ?? !t.done } : t));
        return tasks.find((t) => t.id === id) ?? null;
      },
      deleteTask: async (id) => {
        tasks = tasks.filter((t) => t.id !== id);
      },
      reminders: async () => [],
      addReminder: async (input) => ({ id: uid('r'), text: input.text, at: input.at, dailyAt: input.dailyAt, enabled: true, createdAt: Date.now() }),
      deleteReminder: async () => undefined,
      memories: async () => [
        { id: 'mem1', text: 'Kullanıcı sabahları gündemi sesli dinlemeyi seviyor.', tags: ['tercih'], createdAt: now - 86400000, source: 'agent' },
        { id: 'mem2', text: 'Varsayılan tarayıcı Chrome.', tags: ['sistem'], createdAt: now - 172800000, source: 'agent' },
      ],
      addMemory: async (text, tags) => ({ id: uid('mem'), text, tags: tags ?? [], createdAt: Date.now(), source: 'user' }),
      deleteMemory: async () => undefined,
      files: async () => files,
      deleteFile: async (id) => {
        files = files.filter((f) => f.id !== id);
      },
      agendaLatest: async () => demoDigest,
      agendaRun: async () => demoDigest,
      agendaHistory: async () => [demoDigest],
      audit: async () => [
        { id: 'a1', at: now - 575000, tool: 'open_app', args: { app: 'chrome' }, outcome: 'ok', summary: 'Chrome açıldı.', agent: 'Falcon', durationMs: 820 },
        { id: 'a2', at: now - 590000, tool: 'web_search', args: { query: 'gündem' }, outcome: 'ok', summary: '4 kaynak bulundu.', agent: 'Araştırmacı', durationMs: 2400 },
      ],
      delegations: async () => [],
      tools: async () => TOOL_CATALOG.map((tool) => ({ ...tool, description: tool.label })),
      agents: async () => [
        { name: 'Araştırmacı', emoji: '🔎', tagline: 'Web araması, kaynaklı bilgi, gündem', tools: ['web_search'] },
        { name: 'Kodcu', emoji: '⌨️', tagline: 'Kod yazma, hata ayıklama', tools: ['write_file'] },
        { name: 'Analist', emoji: '📊', tagline: 'Belge, tablo ve veri analizi', tools: ['analyze_document'] },
        { name: 'Planlayıcı', emoji: '🗺️', tagline: 'Plan, takvim, görev', tools: ['add_task'] },
      ],
      backup: async () => 'demo-yedek.json',
      restore: async () => null,
      reset: async () => undefined,
      getCredentialNames: async () => [{ id: 'cred1', name: 'gmail', username: 'umut@example.com' }],
      saveCredential: async () => ({ ok: true }),
      deleteCredential: async () => true,
    },
    files: {
      pick: async () => [],
      pickFolder: async () => null,
      saveText: async () => null,
      stat: async (target) => ({ path: target, exists: true, isDir: false, size: 1200 }),
      home: async () => ({ home: 'C:\\Users\\Umut', documents: 'C:\\Users\\Umut\\Documents', desktop: 'C:\\Users\\Umut\\Desktop', downloads: 'C:\\Users\\Umut\\Downloads' }),
    },
    window: {
      minimize: async () => undefined,
      maximize: async () => undefined,
      close: async () => undefined,
      isMaximized: async () => false,
      setAlwaysOnTop: async () => undefined,
      show: async () => undefined,
    },
    confirm: { respond: async () => undefined },
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onConfirm: (cb) => {
      confirmListeners.add(cb);
      return () => confirmListeners.delete(cb);
    },
    onConfirmResolved: () => () => undefined,
    onFocusMic: () => () => undefined,
    onNavigate: () => () => undefined,
    onEmergencyStop: () => () => undefined,
    app: {
      version: async () => '1.0.0',
      platform: async () => 'win32',
      logs: async () => '[demo] Falcon tarayıcı önizlemesi',
      openLogsFolder: async () => undefined,
      restart: async () => undefined,
      quit: async () => undefined,
    },
  };
  return api;
}

export const api: FalconApi = electronApi ?? createDemoApi();
