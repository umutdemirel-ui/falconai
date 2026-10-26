import { useState } from 'react';
import {
  Activity,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Database,
  FolderOpen,
  Info,
  KeyRound,
  Mic,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Volume2,
  X,
  Zap,
  Server,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import logo from '../../assets/falcon-mark.png';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { voiceEngine } from '../lib/voice';
import { Button, Field, IconChip, Modal, Panel, Segmented, Select, Slider, StatusDot, Toggle } from '../components/ui';
import { ProviderCard } from '../components/ProviderCard';
import { cn, formatRelative } from '../lib/utils';

const TABS = [
  { id: 'general', label: 'Genel', icon: Sliders },
  { id: 'ai', label: 'API ve Modeller', icon: Sparkles },
  { id: 'voice', label: 'Ses ve Konuşma', icon: Volume2 },
  { id: 'permissions', label: 'İzinler ve Güvenlik', icon: Shield },
  { id: 'agenda', label: 'Gündem', icon: CalendarClock },
  { id: 'data', label: 'Veri ve Gizlilik', icon: Database },
  { id: 'about', label: 'Hakkında', icon: Info },
];

const BRAIN_MODELS = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const FAST_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

export function SettingsView() {
  const tab = useStore((s) => s.settingsTab);
  const setTab = useStore((s) => s.setSettingsTab);
  const config = useStore((s) => s.config);
  const providerStates = config?.providerStates ?? [];
  const setPrimaryProvider = useStore((s) => s.setPrimaryProvider);
  const saveConfig = useStore((s) => s.saveConfig);
  const models = useStore((s) => s.models);
  const systemInfo = useStore((s) => s.systemInfo);
  const agenda = useStore((s) => s.agenda);
  const runAgenda = useStore((s) => s.runAgenda);
  const credentials = useStore((s) => s.credentials);
  const refreshCredentials = useStore((s) => s.refreshCredentials);
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);

  const [credOpen, setCredOpen] = useState(false);
  const [credName, setCredName] = useState('');
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');
  const [topic, setTopic] = useState('');

  if (!config) return null;
  const v = config.voice;
  const p = config.permissions;

  const modelOptions = (fallback: string[]) => {
    const discovered = models.map((m) => m.name).filter((name) => !/embedding|image|veo|imagen/.test(name));
    return [...new Set([config.models.brain, ...fallback, ...discovered])];
  };

  return (
    <section className="panel panel-red flex min-w-0 flex-1 overflow-hidden">
      {/* sekmeler */}
      <div className="flex w-[224px] shrink-0 flex-col border-r border-white/[0.06] py-3">
        <div className="mb-2 flex items-center gap-2 px-4">
          <IconChip size="sm">
            <Sliders size={13} />
          </IconChip>
          <span className="text-[12.5px] font-semibold text-white/85">Ayarlar</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-all',
                  active ? 'border border-falcon-500/30 bg-falcon-600/12 text-white' : 'border border-transparent text-white/45 hover:bg-white/[0.03] hover:text-white/80',
                )}
              >
                <Icon size={14} className={active ? 'text-falcon-400' : 'text-white/35'} />
                <span className="flex-1">{item.label}</span>
                <ChevronRight size={12} className={active ? 'text-falcon-400/70' : 'text-white/15'} />
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-4">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] text-white/30">
              <StatusDot tone={config.hasApiKey ? 'green' : 'red'} /> {config.hasApiKey ? 'Sağlayıcı bağlı' : 'Anahtar gerekli'}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/20">
              Gemini, OpenAI, Anthropic, NVIDIA veya Abacus anahtarlarından biri yeterli; anahtarsız yerel çalışma için Ollama.
            </p>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-[920px]">
        {tab === 'general' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white/90">
                <Monitor size={14} className="text-falcon-400" /> Genel
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label mb-1.5">Adın</p>
                  <Field value={config.userName} onChange={(e) => void saveConfig({ userName: e.target.value })} placeholder="Adın" />
                </div>
                <div>
                  <p className="label mb-1.5">Global kısayol</p>
                  <Field
                    value={config.general.globalShortcut}
                    onChange={(e) => void saveConfig({ general: { ...config.general, globalShortcut: e.target.value } })}
                    className="font-mono text-[12px]"
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2.5 border-t border-white/[0.06] pt-3">
                {[
                  { key: 'launchAtLogin' as const, title: 'Bilgisayar açılışında başlat', desc: 'Falcon oturum açıldığında otomatik çalışır' },
                  { key: 'startMinimized' as const, title: 'Arka planda başlat', desc: 'Pencereyi göstermeden tepside başlar' },
                  { key: 'closeToTray' as const, title: 'Kapatınca tepside kal', desc: 'Pencere kapansa da Falcon arka planda çalışır' },
                  { key: 'alwaysOnTop' as const, title: 'Her zaman üstte', desc: 'Pencere diğer uygulamaların üstünde kalır' },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[12px] text-white/75">{row.title}</p>
                      <p className="text-[10.5px] text-white/30">{row.desc}</p>
                    </div>
                    <Toggle
                      checked={Boolean(config.general[row.key])}
                      onChange={(value) => void saveConfig({ general: { ...config.general, [row.key]: value } })}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-falcon-500/20 bg-falcon-600/[0.07] px-2.5 py-2">
                <Zap size={12} className="text-falcon-300" />
                <p className="flex-1 text-[10.5px] text-white/45">
                  Acil durdurma: <span className="font-mono text-falcon-200">{config.general.emergencyShortcut}</span> — Falcon’un tüm işlemlerini anında keser.
                </p>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === 'ai' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconChip size="sm">
                  <Sparkles size={13} />
                </IconChip>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold text-white/90">Yapay zekâ sağlayıcıları</h3>
                  <p className="text-[10.5px] leading-relaxed text-white/35">
                    Bir veya birden fazla anahtar ekleyebilirsin. <span className="text-white/55">Ollama</span> anahtar
                    istemez, bilgisayarında çalışır. Gemini ses, görsel analiz ve gündem için önerilir.
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-white/30">
                  {providerStates.filter((p) => p.hasKey).length}/{providerStates.length} bağlı
                </span>
              </div>

              <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr]">
                <div>
                  <p className="label mb-1.5">Sohbet sağlayıcısı</p>
                  <Select
                    value={config.ai.primary}
                    onChange={(e) => void setPrimaryProvider(e.target.value)}
                    className="text-[12px]"
                  >
                    {providerStates.map((state) => (
                      <option key={state.id} value={state.id} disabled={!state.hasKey}>
                        {state.label}
                        {state.hasKey ? '' : ' — anahtar yok'}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[10px] text-white/25">Araç kullanımı ve akıl yürütme bu sağlayıcıyla yapılır.</p>
                </div>
                <div>
                  <p className="label mb-1.5">Yedekleme</p>
                  <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-white/70">Hata olursa diğerine geç</p>
                      <p className="text-[9.5px] text-white/25">Anahtarı olan sağlayıcılar sırayla denenir</p>
                    </div>
                    <Toggle
                      checked={config.ai.fallback}
                      onChange={(fallback) => void saveConfig({ ai: { ...config.ai, fallback } })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {providerStates.map((state) => (
                  <ProviderCard
                    key={state.id}
                    state={state}
                    primary={config.ai.primary === state.id}
                    onPrimary={() => void setPrimaryProvider(state.id)}
                  />
                ))}
              </div>

              <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-white/25">
                <Shield size={11} className="mt-0.5 shrink-0" />
                Anahtarlar işletim sisteminin güvenli deposuyla (DPAPI / Keychain) şifrelenir, diske düz metin yazılmaz ve hiçbir sunucuya
                gönderilmez.
              </p>
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white/90">
                <Brain size={14} className="text-falcon-400" /> Gemini model eşlemesi
              </h3>
              <p className="mb-3 -mt-1 text-[10.5px] leading-relaxed text-white/30">
                Gemini anahtarı varsa hızlı işler, görsel/PDF analizi, ses ve gündem için bu modeller kullanılır.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { key: 'brain' as const, label: 'Ana model (beyin)', hint: 'Araç kullanımı, akıl yürütme', list: modelOptions(BRAIN_MODELS) },
                  { key: 'fast' as const, label: 'Hızlı model', hint: 'Başlık, sınıflandırma, çeviri', list: modelOptions(FAST_MODELS) },
                  { key: 'vision' as const, label: 'Görsel / belge modeli', hint: 'Ekran, PDF, görsel analizi', list: modelOptions(BRAIN_MODELS) },
                  { key: 'tts' as const, label: 'Seslendirme modeli (TTS)', hint: 'Yanıtları sesli okur', list: modelOptions(TTS_MODELS) },
                  { key: 'stt' as const, label: 'Yazıya dökme modeli (STT)', hint: 'Sesli komutları metne çevirir', list: modelOptions(BRAIN_MODELS) },
                  { key: 'search' as const, label: 'Arama / gündem modeli', hint: 'Google Arama destekli', list: modelOptions(BRAIN_MODELS) },
                ].map((row) => (
                  <div key={row.key}>
                    <p className="label mb-1.5">{row.label}</p>
                    <Select
                      value={config.models[row.key]}
                      onChange={(e) => void saveConfig({ models: { ...config.models, [row.key]: e.target.value } })}
                      className="text-[12px]"
                    >
                      {[...new Set([config.models[row.key], ...row.list])].map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-[10px] text-white/25">{row.hint}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="label">Yaratıcılık (temperature)</p>
                    <span className="text-[11px] tabular-nums text-white/55">{config.models.temperature.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={config.models.temperature}
                    onChange={(value) => void saveConfig({ models: { ...config.models, temperature: value } })}
                  />
                </div>
                <div>
                  <p className="label mb-1.5">Maksimum yanıt uzunluğu</p>
                  <Select
                    value={String(config.models.maxOutputTokens)}
                    onChange={(e) => void saveConfig({ models: { ...config.models, maxOutputTokens: Number(e.target.value) } })}
                    className="text-[12px]"
                  >
                    {[2048, 4096, 8192, 16384, 32768, 65536].map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString('tr-TR')} token
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-[12px] text-white/75">Model bulunamazsa otomatik geç</p>
                  <p className="text-[10.5px] text-white/30">Google’da erişilebilen en yakın model kullanılır</p>
                </div>
                <Toggle
                  checked={config.models.autoFallback}
                  onChange={(autoFallback) => void saveConfig({ models: { ...config.models, autoFallback } })}
                />
              </div>
            </Panel>

            {models.length ? (
              <Panel className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Server size={14} className="text-falcon-400" />
                  <span className="text-[12.5px] font-semibold text-white/85">Hesabında etkin modeller</span>
                  <span className="text-[10px] text-white/25">{models.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {models.map((m) => (
                    <span key={m.name} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-white/45">
                      {m.name}
                    </span>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        ) : null}

        {tab === 'voice' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Mic size={14} className="text-falcon-400" />
                <span className="flex-1 text-[13px] font-semibold text-white/90">Ses ve Konuşma</span>
                <Button size="sm" variant="ghost" onClick={() => setView('voice')}>
                  Sesli asistan sayfası <ChevronRight size={12} />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label mb-1.5">Ses motoru</p>
                  <Segmented
                    value={v.engine}
                    onChange={(engine) => void saveConfig({ voice: { ...v, engine } })}
                    options={[
                      { value: 'gemini', label: 'Gemini' },
                      { value: 'system', label: 'Sistem' },
                      { value: 'off', label: 'Kapalı' },
                    ]}
                  />
                </div>
                <div>
                  <p className="label mb-1.5">Gemini sesi</p>
                  <Select value={v.voice} onChange={(e) => void saveConfig({ voice: { ...v, voice: e.target.value } })} className="text-[12px]">
                    {GEMINI_VOICES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <p className="label mb-1.5">Ses tonu yönergesi</p>
                  <Field value={v.style} onChange={(e) => void saveConfig({ voice: { ...v, style: e.target.value } })} className="text-[12px]" />
                </div>
              </div>
              <div className="mt-3 space-y-2.5 border-t border-white/[0.06] pt-3">
                {[
                  { key: 'autoSpeak' as const, title: 'Yanıtları sesli oku', desc: 'Her yanıt otomatik seslendirilir' },
                  { key: 'continuousListening' as const, title: 'Sürekli dinleme', desc: 'Falcon konuştuktan sonra mikrofon yeniden açılır' },
                  { key: 'wakeWordEnabled' as const, title: 'Uyandırma sözcüğü', desc: `Yalnızca "${v.wakePhrase}" duyulduğunda komut al` },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] text-white/75">{row.title}</p>
                      <p className="text-[10.5px] text-white/30">{row.desc}</p>
                    </div>
                    <Toggle checked={Boolean(v[row.key])} onChange={(value) => void saveConfig({ voice: { ...v, [row.key]: value } })} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => void voiceEngine.preview()}>
                  <Volume2 size={12} /> Sesi dinle
                </Button>
                <span className="text-[10px] text-white/25">TTS: {config.models.tts}</span>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === 'permissions' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Shield size={14} className="text-falcon-400" />
                <span className="flex-1 text-[13px] font-semibold text-white/90">Yetki seviyesi</span>
              </div>
              <Segmented
                value={p.mode}
                onChange={(mode) => void saveConfig({ permissions: { ...p, mode } })}
                options={[
                  { value: 'manual', label: 'Her işlemde sor' },
                  { value: 'smart', label: 'Akıllı' },
                  { value: 'full', label: 'Tam yetki' },
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                {p.mode === 'full'
                  ? 'Falcon soruların çoğunu sormadan yapar. Yalnızca ayarlarda açıkça işaretlediğin yıkıcı işlemler için onay ister.'
                  : p.mode === 'smart'
                    ? 'Dosya yazma, terminal, silme ve kapatma gibi riskli işlemlerde onay ister; diğerlerini serbestçe yapar.'
                    : 'Her araç çağrısından önce onay kutusu çıkar. En güvenli ama en yavaş mod.'}
              </p>
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-2.5 text-[13px] font-semibold text-white/90">Yetenekler</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'fileAccess' as const, label: 'Dosya erişimi', desc: 'Oku, yaz, ara, sil' },
                  { key: 'appControl' as const, label: 'Uygulama denetimi', desc: 'Aç, kapat, klavye, giriş' },
                  { key: 'terminal' as const, label: 'Terminal komutları', desc: 'Komut çalıştırma' },
                  { key: 'power' as const, label: 'Güç işlemleri', desc: 'Kapat, yeniden başlat, kilitle' },
                  { key: 'clipboard' as const, label: 'Pano erişimi', desc: 'Kopyala, yapıştır' },
                  { key: 'network' as const, label: 'Ağ / web', desc: 'Tarayıcı aç, web araması' },
                  { key: 'microphone' as const, label: 'Mikrofon', desc: 'Sesli komutlar' },
                  { key: 'camera' as const, label: 'Kamera', desc: 'Kamera erişimi' },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-2">
                    <div>
                      <p className="text-[11.5px] text-white/75">{row.label}</p>
                      <p className="text-[10px] text-white/25">{row.desc}</p>
                    </div>
                    <Toggle checked={Boolean(p[row.key])} onChange={(value) => void saveConfig({ permissions: { ...p, [row.key]: value } })} />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-2.5 text-[13px] font-semibold text-white/90">Ek onaylar</h3>
              <div className="space-y-2.5">
                {[
                  { key: 'confirmDelete' as const, title: 'Silme işlemlerinde onay iste', desc: 'delete_path çağrıları önce sorar' },
                  { key: 'confirmTerminal' as const, title: 'Terminal komutlarında onay iste', desc: 'Her komut öncesi gösterilir' },
                  { key: 'confirmPower' as const, title: 'Kapatma/kilitlemede onay iste', desc: 'Güç işlemleri önce sorar' },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] text-white/75">{row.title}</p>
                      <p className="text-[10.5px] text-white/30">{row.desc}</p>
                    </div>
                    <Toggle checked={Boolean(p[row.key])} onChange={(value) => void saveConfig({ permissions: { ...p, [row.key]: value } })} />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <FolderOpen size={14} className="text-falcon-400" />
                <span className="flex-1 text-[12.5px] font-semibold text-white/85">Erişilebilen klasörler</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const folder = await api.files.pickFolder();
                    if (folder) void saveConfig({ permissions: { ...p, allowedRoots: [...p.allowedRoots, folder] } });
                  }}
                >
                  <Plus size={12} /> Klasör ekle
                </Button>
              </div>
              <div className="space-y-1.5">
                {(p.allowedRoots.length ? p.allowedRoots : ['Varsayılan: kullanıcı ev dizini']).map((root) => (
                  <div key={root} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-black/25 px-2.5 py-1.5">
                    <FolderOpen size={12} className="text-white/30" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-white/55">{root}</span>
                    {p.allowedRoots.length ? (
                      <button
                        type="button"
                        className="icon-btn h-5 w-5"
                        onClick={() => void saveConfig({ permissions: { ...p, allowedRoots: p.allowedRoots.filter((r) => r !== root) } })}
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-white/25">
                Sistem klasörleri (Windows, Program Files, /etc, /usr…) her koşulda korumalıdır ve Falcon bunlara yazamaz.
              </p>
            </Panel>

            <Panel className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <KeyRound size={14} className="text-falcon-400" />
                <span className="flex-1 text-[12.5px] font-semibold text-white/85">Kayıtlı hesaplar (şifreli kasa)</span>
                <Button size="sm" variant="ghost" onClick={() => setCredOpen(true)}>
                  <Plus size={12} /> Hesap ekle
                </Button>
              </div>
              <div className="space-y-1.5">
                {credentials.map((cred) => (
                  <div key={cred.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5">
                    <KeyRound size={12} className="text-emerald-300/70" />
                    <span className="text-[11.5px] text-white/70">{cred.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-white/30">{cred.username}</span>
                    <button
                      type="button"
                      className="icon-btn h-5 w-5 hover:text-falcon-300"
                      onClick={async () => {
                        await api.data.deleteCredential(cred.name);
                        await refreshCredentials();
                        pushToast({ kind: 'info', title: 'Hesap silindi', body: cred.name });
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {credentials.length === 0 ? (
                  <p className="py-2 text-[11px] text-white/25">Kayıtlı hesap yok. “Gmail’e giriş yap” gibi komutlar için hesap ekleyebilirsin.</p>
                ) : null}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-white/25">
                Şifreler işletim sisteminin güvenli deposuyla şifrelenir. Model şifreyi asla görmez; yalnızca “hesap adı” bilgisini bilir.
              </p>
            </Panel>
          </div>
        ) : null}

        {tab === 'agenda' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock size={14} className="text-falcon-400" />
                <span className="flex-1 text-[13px] font-semibold text-white/90">Gündem takibi</span>
                <Toggle
                  checked={config.agenda.enabled}
                  onChange={(enabled) => void saveConfig({ agenda: { ...config.agenda, enabled } })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label mb-1.5">Günlük özet saati</p>
                  <Field
                    type="time"
                    value={config.agenda.time}
                    onChange={(e) => void saveConfig({ agenda: { ...config.agenda, time: e.target.value } })}
                    className="text-[12px]"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <span className="text-[11.5px] text-white/60">Sesli özetle</span>
                    <Toggle
                      checked={config.agenda.speak}
                      onChange={(speak) => void saveConfig({ agenda: { ...config.agenda, speak } })}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <p className="label mb-1.5">Takip edilen konular</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {config.agenda.topics.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/60">
                      {t}
                      <button
                        type="button"
                        onClick={() =>
                          void saveConfig({ agenda: { ...config.agenda, topics: config.agenda.topics.filter((x) => x !== t) } })
                        }
                        className="text-white/30 hover:text-falcon-300"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Field
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Yeni konu: ör. Yapay zekâ"
                    className="py-1.5 text-[12px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && topic.trim()) {
                        void saveConfig({ agenda: { ...config.agenda, topics: [...config.agenda.topics, topic.trim()] } });
                        setTopic('');
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!topic.trim()) return;
                      void saveConfig({ agenda: { ...config.agenda, topics: [...config.agenda.topics, topic.trim()] } });
                      setTopic('');
                    }}
                  >
                    <Plus size={12} />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                <Button size="sm" variant="primary" onClick={() => void runAgenda(true)}>
                  <Sparkles size={12} /> Şimdi özetle
                </Button>
                <span className="text-[10.5px] text-white/25">Google Arama destekli Gemini kullanılır</span>
              </div>
            </Panel>

            {agenda ? (
              <Panel className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-white/85">Son özet</span>
                  <span className="text-[10px] text-white/30">{formatRelative(agenda.createdAt)}</span>
                </div>
                <p className="text-[12px] font-medium text-white/80">{agenda.headline}</p>
                <div className="mt-2 space-y-2">
                  {agenda.items.map((item, i) => (
                    <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-2">
                      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-white/75">
                        <span className="rounded bg-falcon-600/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-falcon-200/80">{item.category}</span>
                        {item.title}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-white/40">{item.summary}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-white/90">
                <Database size={14} className="text-falcon-400" /> Verilerin
              </h3>
              <p className="text-[11.5px] leading-relaxed text-white/40">
                Sohbetler, projeler, görevler, hatırlatıcılar ve hafıza yalnızca bu bilgisayarda tutulur. Falcon kendi sunucusuna
                veri göndermez; yalnızca seçtiğin sağlayıcının API’sine (Gemini, OpenAI, Anthropic, NVIDIA, Abacus) istek gider.
                Yerel Ollama modunda sohbet istekleri bilgisayarından çıkmaz.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const file = await api.data.backup();
                    if (file) pushToast({ kind: 'success', title: 'Yedek alındı', body: file });
                  }}
                >
                  <Save size={12} /> Yedek al
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const result = await api.data.restore();
                    if (result) {
                      await useStore.getState().refreshAll();
                      pushToast({ kind: 'success', title: 'Yedek geri yüklendi' });
                    }
                  }}
                >
                  <RefreshCw size={12} /> Yedekten geri yükle
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api.app.openLogsFolder()}>
                  <FolderOpen size={12} /> Günlükleri aç
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api.app.logs()}>
                  <Activity size={12} /> Günlük özeti
                </Button>
              </div>
            </Panel>

            <Panel className="border-falcon-600/30 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-falcon-200">
                <Trash2 size={14} /> Tehlikeli işlemler
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-2">
                  <div>
                    <p className="text-[11.5px] text-white/75">Tüm sohbetleri sil</p>
                    <p className="text-[10px] text-white/25">Sohbet geçmişi ve mesajlar silinir</p>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      await api.chat.clear();
                      await useStore.getState().refreshAll();
                      useStore.setState({ conversations: [], messages: [], activeId: null });
                      pushToast({ kind: 'info', title: 'Sohbetler silindi' });
                    }}
                  >
                    Sil
                  </Button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-2">
                  <div>
                    <p className="text-[11.5px] text-white/75">Ayarları sıfırla</p>
                    <p className="text-[10px] text-white/25">API anahtarı korunur</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const next = await api.config.reset();
                      useStore.setState({ config: next });
                      pushToast({ kind: 'info', title: 'Ayarlar sıfırlandı' });
                    }}
                  >
                    Sıfırla
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === 'about' ? (
          <div className="space-y-4">
            <Panel className="flex items-center gap-4 p-5">
              <img src={logo} alt="Falcon" className="h-16 w-16 object-contain drop-shadow-[0_0_20px_rgba(255,45,45,0.45)]" />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[18px] font-bold tracking-wide text-white">FALCON AI</h3>
                <p className="text-[11.5px] text-white/40">Bilgisayarında tam yetkiyle çalışan, sesli Türkçe yapay zekâ ajanı.</p>
                <p className="mt-1 text-[10.5px] text-white/25">
                  sürüm {systemInfo?.appVersion ?? '1.0.0'} · Electron {systemInfo?.electron ?? '—'} · Chromium {systemInfo?.chrome ?? '—'}
                </p>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-300">Yerel + Gemini</span>
            </Panel>

            <Panel className="p-4">
              <h3 className="mb-2 text-[12.5px] font-semibold text-white/85">Nasıl çalışır?</h3>
              <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-white/45">
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> Akıl yürütme ve araç kullanımı seçtiğin sağlayıcıyla (Gemini, OpenAI, Anthropic, NVIDIA, Abacus veya yerel Ollama) yapılır; ses ve gündem Gemini/OpenAI ile çalışır.</li>
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> Uygulama açma/kapatma, klavye, dosya, terminal ve güç işlemleri yerel olarak (Electron) yürütülür.</li>
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> Veriler cihazında kalır; şifreler işletim sistemi kasasında saklanır.</li>
                <li className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> Her araç çağrısı denetim kaydına yazılır (Veri ve Gizlilik).</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void api.system.openUrl('https://ai.google.dev/gemini-api/docs')}>
                  <ExternalLink size={12} /> Gemini API belgeleri
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api.system.openUrl('https://aistudio.google.com/apikey')}>
                  <KeyRound size={12} /> API anahtarı
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api.app.restart()}>
                  <RefreshCw size={12} /> Uygulamayı yeniden başlat
                </Button>
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
                  <p className="text-white/30">Sistem</p>
                  <p className="mt-0.5 text-white/70">{systemInfo?.platformLabel} · {systemInfo?.osVersion}</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
                  <p className="text-white/30">Donanım</p>
                  <p className="mt-0.5 text-white/70">{systemInfo?.cores} çekirdek · {systemInfo?.totalMemGb} GB RAM</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
                  <p className="text-white/30">Model</p>
                  <p className="mt-0.5 font-mono text-white/70">{config.models.brain}</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
                  <p className="text-white/30">Ses</p>
                  <p className="mt-0.5 text-white/70">{config.models.tts} · {config.voice.voice}</p>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}
        </div>
      </div>

      <Modal
        open={credOpen}
        onClose={() => setCredOpen(false)}
        title="Hesap ekle"
        description="Şifre, işletim sisteminin güvenli kasasında şifrelenerek saklanır. Model bu şifreyi görmez."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCredOpen(false)}>
              Vazgeç
            </Button>
            <Button
              variant="primary"
              disabled={!credName.trim() || !credUser.trim() || !credPass.trim()}
              onClick={async () => {
                await api.data.saveCredential({ name: credName.trim(), username: credUser.trim(), password: credPass });
                await refreshCredentials();
                setCredOpen(false);
                setCredName('');
                setCredUser('');
                setCredPass('');
                pushToast({ kind: 'success', title: 'Hesap kasaya eklendi' });
              }}
            >
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label mb-1.5 block">Hesap adı</label>
            <Field value={credName} onChange={(e) => setCredName(e.target.value)} placeholder="gmail, spotify, instagram…" autoFocus />
          </div>
          <div>
            <label className="label mb-1.5 block">Kullanıcı adı / e-posta</label>
            <Field value={credUser} onChange={(e) => setCredUser(e.target.value)} placeholder="ornek@mail.com" />
          </div>
          <div>
            <label className="label mb-1.5 block">Şifre</label>
            <Field type="password" value={credPass} onChange={(e) => setCredPass(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
      </Modal>
    </section>
  );
}
