import { useEffect, useState } from 'react';
import {
  Activity,
  AppWindow,
  Bug,
  Camera,
  Code2,
  FileSearch,
  Gauge,
  HardDrive,
  History,
  Lock,
  Mic,
  MonitorPlay,
  Moon,
  Pause,
  Play,
  Power,
  RefreshCw,
  SkipBack,
  SkipForward,
  Sun,
  Terminal,
  Trash,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, IconChip, Modal, Panel, Slider } from '../components/ui';
import { toolIcon } from '../lib/icons';
import { cn, formatRelative, riskLabels } from '../lib/utils';
import type { RunningProcess } from '../../shared/types';

const FEATURES = [
  {
    icon: Mic,
    title: 'Sesli Komutlar',
    description: 'Doğal dilde konuş, Falcon anlasın ve istediğini yapsın.',
    example: 'Örn: “Falcon, bilgisayarımda klasör aç.”',
    prompt: 'Sesli komutla bilgisayarımda yeni bir klasör aç: Masaüstünde "Falcon Test" klasörü oluştur.',
  },
  {
    icon: Code2,
    title: 'Kod Yardımı',
    description: 'Kod yaz, hataları bul, açıkla, dosyaya kaydet.',
    example: 'Örn: “Bu kodda hata var mı?”',
    prompt: 'Python ile bir klasördeki tüm resimleri yeniden boyutlandıran bir betik yaz ve dosyaya kaydet.',
  },
  {
    icon: FileSearch,
    title: 'Dosya Analizi',
    description: 'PDF, metin ve belgeleri analiz et, özetle, çevir.',
    example: 'Örn: “Bu PDF dosyasını özetle.”',
    prompt: 'Belgeler klasörümdeki en son PDF dosyasını bul, oku ve Türkçe özetle.',
  },
  {
    icon: MonitorPlay,
    title: 'Bilgisayarda İşlem',
    description: 'İzin verilen işlemleri gerçekleştir, uygulamaları yönet.',
    example: 'Örn: “Not defterini aç.”',
    prompt: 'Not defterini aç ve içine bugünün gündem maddelerini yaz.',
  },
];

export function ToolsView() {
  const systemInfo = useStore((s) => s.systemInfo);
  const refreshSystem = useStore((s) => s.refreshSystem);
  const tools = useStore((s) => s.tools);
  const agents = useStore((s) => s.agents);
  const audit = useStore((s) => s.audit);
  const refreshAudit = useStore((s) => s.refreshAudit);
  const pushToast = useStore((s) => s.pushToast);
  const setView = useStore((s) => s.setView);
  const setDraft = useStore((s) => s.setDraft);
  const config = useStore((s) => s.config);

  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(80);
  const [running, setRunning] = useState<RunningProcess[]>([]);
  const [confirmPower, setConfirmPower] = useState<null | 'shutdown' | 'restart' | 'sleep' | 'lock'>(null);
  const [loadingRunning, setLoadingRunning] = useState(false);

  useEffect(() => {
    void refreshSystem();
    void refreshAudit();
    void loadRunning();
  }, [refreshSystem, refreshAudit]);

  const loadRunning = async () => {
    setLoadingRunning(true);
    try {
      setRunning(await api.system.running());
    } catch {
      setRunning([]);
    } finally {
      setLoadingRunning(false);
    }
  };

  const action = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      pushToast({ kind: 'success', title: success });
      void refreshAudit();
    } catch (err) {
      pushToast({ kind: 'error', title: 'İşlem başarısız', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const askFalcon = (prompt: string) => {
    setView('chat');
    setDraft(prompt);
  };

  const executePower = async () => {
    if (!confirmPower) return;
    const actionMap = confirmPower;
    setConfirmPower(null);
    await action(() => api.system.power(actionMap, 30), `Komut gönderildi: ${actionMap}`);
  };

  return (
    <section className="panel panel-red flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-5 py-3.5">
        <IconChip size="sm">
          <MonitorPlay size={14} />
        </IconChip>
        <div className="flex-1">
          <h2 className="text-[13.5px] font-semibold text-white/90">Bilgisayar Araçları</h2>
          <p className="text-[10.5px] text-white/35">
            {systemInfo ? `${systemInfo.platformLabel} · ${systemInfo.hostname} · ${systemInfo.cpu}` : 'Sistem bilgisi alınıyor…'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-white/35">
          <span className="flex items-center gap-1">
            <Activity size={11} /> %{100 - (systemInfo?.memUsedPct ?? 40)} boş bellek
          </span>
          <span className="flex items-center gap-1">
            <HardDrive size={11} /> {systemInfo?.volumes?.[0]?.freeGb ?? '—'} GB
          </span>
          <button type="button" className="icon-btn h-7 w-7" title="Yenile" onClick={() => { void refreshSystem(); void loadRunning(); }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {/* dört yetenek kartı */}
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <button
                key={feature.title}
                type="button"
                onClick={() => askFalcon(feature.prompt)}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.035] to-transparent p-3.5 text-left transition-all hover:border-falcon-500/35 hover:shadow-[0_0_34px_-20px_rgba(255,47,47,0.9)]"
              >
                <div className="mb-2 flex items-center gap-2">
                  <IconChip size="sm">
                    <Icon size={14} />
                  </IconChip>
                  <span className="text-[12.5px] font-semibold text-white/90">{feature.title}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-white/45">{feature.description}</p>
                <p className="mt-2 text-[10.5px] text-falcon-300/70">{feature.example}</p>
                <span className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-falcon-600/10 blur-xl transition-all group-hover:bg-falcon-600/20" />
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          {/* denetim */}
          <Panel className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Gauge size={14} className="text-falcon-400" />
              <span className="flex-1 text-[12.5px] font-semibold text-white/85">Hızlı Denetim</span>
              <span className="text-[10px] text-white/25">gerçek işlem yapar</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-white/60">
                  <Volume2 size={12} /> Ses seviyesi
                </div>
                <Slider
                  value={volume}
                  onChange={(value) => {
                    setVolume(value);
                  }}
                  suffix="%"
                />
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => void action(() => api.system.volume(volume), `Ses %${volume}`)}>
                    Uygula
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void action(() => api.system.muted(true), 'Ses kapatıldı')} title="Sessize al">
                    <VolumeX size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void action(() => api.system.muted(false), 'Ses açıldı')} title="Sesi aç">
                    <Volume2 size={12} />
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-white/60">
                  <Sun size={12} /> Parlaklık
                </div>
                <Slider value={brightness} onChange={setBrightness} suffix="%" />
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => void action(() => api.system.brightness(brightness), `Parlaklık %${brightness}`)}>
                    Uygula
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void action(() => api.system.media('play_pause'), 'Medya komutu')} title="Oynat/Duraklat">
                    <Play size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void action(() => api.system.media('next'), 'Sonraki parça')} title="Sonraki">
                    <SkipForward size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void action(() => api.system.media('previous'), 'Önceki parça')} title="Önceki">
                    <SkipBack size={12} />
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { icon: Camera, label: 'Ekran görüntüsü', run: () => action(async () => { const r = await api.system.screenshot(); pushToast({ kind: 'success', title: 'Ekran görüntüsü alındı', body: r.file }); }, 'Ekran görüntüsü') },
                { icon: Moon, label: 'Karanlık mod', run: () => askFalcon('Sistem temasını değiştir.') },
                { icon: Lock, label: 'Ekranı kilitle', run: () => setConfirmPower('lock') },
                { icon: Trash, label: 'Çöpü boşalt', run: () => askFalcon('Çöp kutusunu boşalt.') },
                { icon: Terminal, label: 'Terminal aç', run: () => action(() => api.system.openApp('terminal'), 'Terminal açılıyor') },
                { icon: AppWindow, label: 'Uygulama aç', run: () => { void api.system.apps(); askFalcon('Chrome tarayıcısını aç.'); } },
                { icon: Pause, label: 'Uyku modu', run: () => setConfirmPower('sleep') },
                { icon: Power, label: 'Kapat', run: () => setConfirmPower('shutdown'), danger: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void item.run()}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[10.5px] transition-all',
                      item.danger
                        ? 'border-falcon-500/35 bg-falcon-600/10 text-falcon-100 hover:bg-falcon-600/20'
                        : 'border-white/[0.07] bg-white/[0.02] text-white/55 hover:border-falcon-500/30 hover:text-white/85',
                    )}
                  >
                    <Icon size={15} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
              <Bug size={12} className="text-white/30" />
              <p className="flex-1 text-[10.5px] leading-relaxed text-white/30">
                Tam yetki modundasın. Silme ve kapatma komutları için ayarlardan onay isteyebilirsin.
              </p>
              <button
                type="button"
                className="red-link"
                onClick={() => {
                  useStore.getState().setSettingsTab('permissions');
                  setView('settings');
                }}
              >
                İzinler
              </button>
            </div>
          </Panel>

          {/* çalışan uygulamalar + ajanlar */}
          <div className="space-y-4">
            <Panel className="p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Activity size={14} className="text-falcon-400" />
                <span className="flex-1 text-[12.5px] font-semibold text-white/85">Çalışan Uygulamalar</span>
                <button type="button" className="icon-btn h-6 w-6" onClick={() => void loadRunning()} title="Yenile">
                  <RefreshCw size={12} className={loadingRunning ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="max-h-[172px] space-y-0.5 overflow-y-auto">
                {running.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-white/25">Uygulama listesi alınamadı veya açık uygulama yok.</p>
                ) : (
                  running.slice(0, 40).map((proc) => (
                    <div key={`${proc.pid}-${proc.name}`} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                      <span className="flex-1 truncate text-[11.5px] text-white/65">{proc.name}</span>
                      <span className="font-mono text-[9.5px] text-white/20">#{proc.pid}</span>
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[9.5px] text-white/30 opacity-0 transition-colors hover:bg-falcon-600/20 hover:text-falcon-200 group-hover:opacity-100"
                        onClick={() => void action(() => api.system.closeApp(proc.name), `${proc.name} kapatıldı`)}
                      >
                        kapat
                      </button>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Users size={14} className="text-falcon-400" />
                <span className="flex-1 text-[12.5px] font-semibold text-white/85">Uzman Ajanlar</span>
                <span className="text-[10px] text-white/25">iş birliği</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {agents.map((agent) => (
                  <div key={agent.name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-white/75">
                      <span>{agent.emoji}</span>
                      {agent.name}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[9.5px] leading-relaxed text-white/30">{agent.tagline}</p>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2.5 w-full"
                onClick={() => askFalcon('Araştırmacı ajanı kullanarak bugünün teknoloji gündemini araştır ve özetle.')}
              >
                <Zap size={12} /> Uzman ajana iş devret
              </Button>
            </Panel>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          <Panel className="p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Wrench size={14} className="text-falcon-400" />
              <span className="flex-1 text-[12.5px] font-semibold text-white/85">Araç Kataloğu</span>
              <span className="text-[10px] text-white/25">{tools.length} araç · {config?.permissions.mode === 'full' ? 'tam yetki' : config?.permissions.mode}</span>
            </div>
            <div className="grid max-h-[260px] gap-1.5 overflow-y-auto sm:grid-cols-2">
              {tools.map((tool) => {
                const Icon = toolIcon(tool.icon);
                const risk = riskLabels[tool.risk] ?? riskLabels.safe;
                return (
                  <div key={tool.name} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2 py-1.5">
                    <Icon size={12} className="shrink-0 text-falcon-400/70" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-white/65">{tool.label}</span>
                    <span className={cn('shrink-0 rounded border px-1 py-0.5 text-[8.5px] uppercase', risk.className)}>{risk.label}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <History size={14} className="text-falcon-400" />
              <span className="flex-1 text-[12.5px] font-semibold text-white/85">Son İşlemler</span>
              <span className="text-[10px] text-white/25">denetim kaydı</span>
            </div>
            <div className="max-h-[260px] space-y-1 overflow-y-auto">
              {audit.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-white/25">Henüz işlem yok.</p>
              ) : (
                audit.slice(0, 30).map((entry) => {
                  const Icon = toolIcon(entry.tool);
                  return (
                    <div key={entry.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      <Icon size={11} className={cn('mt-0.5 shrink-0', entry.outcome === 'ok' ? 'text-emerald-400/70' : 'text-falcon-400/80')} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] text-white/60">{entry.summary}</p>
                        <p className="text-[9.5px] text-white/25">
                          {entry.agent} · {entry.tool} · {formatRelative(entry.at)} · {entry.durationMs} ms
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Modal
        open={confirmPower !== null}
        onClose={() => setConfirmPower(null)}
        title={
          confirmPower === 'shutdown'
            ? 'Bilgisayar kapatılsın mı?'
            : confirmPower === 'restart'
              ? 'Yeniden başlatılsın mı?'
              : confirmPower === 'sleep'
                ? 'Uyku moduna geçilsin mi?'
                : 'Ekran kilitlensin mi?'
        }
        description="Bu işlem Falcon aracılığıyla gerçekten uygulanacak."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPower(null)}>
              Vazgeç
            </Button>
            <Button variant="primary" onClick={() => void executePower()}>
              Onayla
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-white/55">
          {confirmPower === 'shutdown'
            ? 'Kapatma 30 saniye gecikmeyle başlatılır. "Kapatmayı iptal et" diyerek ya da terminalde "shutdown /a" komutuyla iptal edebilirsin.'
            : 'Kaydedilmemiş çalışmalarını kaydetmeyi unutma.'}
        </p>
      </Modal>
    </section>
  );
}
