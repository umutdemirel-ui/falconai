import { useState } from 'react';
import {
  Activity,
  ChevronDown,
  Cpu,
  FolderOpen,
  HardDrive,
  KeyRound,
  Mic,
  Newspaper,
  Shield,
  Sparkles,
  Camera,
  FileText,
  MonitorPlay,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, CardHeader, IconChip, KeyValue, Panel, Select, StatusDot, Toggle } from './ui';
import { cn, formatRelative, greeting } from '../lib/utils';

const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-4-argon',
];

export function RightRail() {
  const config = useStore((s) => s.config);
  const systemInfo = useStore((s) => s.systemInfo);
  const projects = useStore((s) => s.projects);
  const setView = useStore((s) => s.setView);
  const setSettingsTab = useStore((s) => s.setSettingsTab);
  const saveConfig = useStore((s) => s.saveConfig);
  const setProviderModel = useStore((s) => s.setProviderModel);
  const testConnection = useStore((s) => s.testConnection);
  const agenda = useStore((s) => s.agenda);
  const runAgenda = useStore((s) => s.runAgenda);
  const models = useStore((s) => s.models);
  const [testing, setTesting] = useState(false);
  const [agendaLoading, setAgendaLoading] = useState(false);

  const permissions = config?.permissions;
  const modelOptions = (models.length ? models.map((m) => m.name) : FALLBACK_MODELS).filter(
    (name) => !/tts|embedding|image|veo|imagen/.test(name),
  );

  const providerStates = config?.providerStates ?? [];
  const activeProvider = providerStates.find((p) => p.id === (config?.ai.primary ?? 'gemini')) ?? providerStates[0];
  const isGemini = !activeProvider || activeProvider.id === 'gemini';
  const activeModel = isGemini
    ? config?.models.brain ?? activeProvider?.model ?? 'gemini-3.8-flash'
    : activeProvider?.model || activeProvider?.defaultModel || '';
  const providerModels = activeProvider
    ? [...new Set([activeProvider.model, activeProvider.defaultModel])].filter(Boolean)
    : [];

  const togglePermission = (key: 'fileAccess' | 'appControl' | 'microphone' | 'camera') => {
    if (!config) return;
    void saveConfig({ permissions: { ...config.permissions, [key]: !config.permissions[key] } });
  };

  const runTest = async () => {
    setTesting(true);
    try {
      await testConnection();
    } finally {
      setTesting(false);
    }
  };

  const makeAgenda = async () => {
    setAgendaLoading(true);
    try {
      await runAgenda(true);
    } finally {
      setAgendaLoading(false);
    }
  };

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-3 overflow-y-auto pr-0.5 [&>*]:shrink-0 xl:flex">
      {/* Sağlayıcı */}
      <Panel red className="overflow-hidden">
        <div className="flex items-start gap-2.5 px-4 pb-2.5 pt-3.5">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
            <Sparkles size={14} className="text-emerald-300" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white/90">{activeProvider?.label ?? 'Yapay zekâ sağlayıcısı'}</p>
            <p className="truncate text-[10.5px] text-white/35">
              Bulut API · {activeProvider?.hasKey ? 'anahtar kayıtlı' : 'anahtar yok'}
            </p>
          </div>
          <StatusDot tone={config?.hasApiKey ? 'green' : 'red'} pulse={Boolean(config?.hasApiKey)} />
        </div>

        <div className="mx-3 mb-2.5 rounded-xl border border-white/[0.07] bg-black/30 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label">Model</span>
            <button
              type="button"
              className="red-link flex items-center gap-0.5"
              onClick={() => {
                setSettingsTab('ai');
                setView('settings');
              }}
            >
              Değiştir <ChevronDown size={11} />
            </button>
          </div>
          <Select
            value={activeModel}
            onChange={(e) => {
              if (!config || !activeProvider) return;
              if (isGemini) void saveConfig({ models: { ...config.models, brain: e.target.value, vision: e.target.value } });
              else void setProviderModel(activeProvider.id, e.target.value);
            }}
            className="py-1.5 text-[11.5px]"
          >
            {(isGemini ? modelOptions : providerModels).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2 px-3 pb-3">
          <Button size="sm" variant="ghost" className="flex-1" onClick={() => void runTest()} disabled={testing}>
            {testing ? 'Test ediliyor…' : 'Bağlantıyı test et'}
          </Button>
          <span className="flex items-center gap-1 text-[10.5px] text-white/30">
            <KeyRound size={11} /> {config?.hasApiKey ? 'anahtar kayıtlı' : 'anahtar yok'}
          </span>
        </div>
      </Panel>

      {/* Sistem durumu */}
      <Panel>
        <CardHeader icon={<Activity size={14} />} title="Sistem Durumu" />
        <div className="px-4 pb-3">
          <KeyValue
            label="API Bağlantısı"
            value={
              <span className={cn('flex items-center gap-1.5', config?.hasApiKey ? 'text-emerald-300/90' : 'text-falcon-300')}>
                <StatusDot tone={config?.hasApiKey ? 'green' : 'red'} />
                {config?.hasApiKey ? 'Çalışıyor' : 'Anahtar yok'}
              </span>
            }
          />
          <KeyValue label="Model Yüklü" value={<span className="text-falcon-200/90">{activeModel || '—'}</span>} mono />
          <KeyValue
            label="Bellek Kullanımı"
            value={
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-falcon-500 to-falcon-400"
                    style={{ width: `${systemInfo?.memUsedPct ?? 42}%` }}
                  />
                </span>
                <span className="text-falcon-200/90">%{systemInfo?.memUsedPct ?? 42}</span>
              </span>
            }
          />
          <div className="mt-2 border-t border-white/[0.05] pt-2">
            <div className="flex items-center justify-between text-[10.5px] text-white/30">
              <span className="flex items-center gap-1">
                <Cpu size={10} /> {systemInfo?.cpu?.slice(0, 26) ?? 'Sistem'}
              </span>
              <span className="flex items-center gap-1">
                <HardDrive size={10} /> {systemInfo?.volumes?.[0] ? `${systemInfo.volumes[0].freeGb} GB boş` : '—'}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* Gündem */}
      <Panel>
        <CardHeader
          icon={<Newspaper size={14} />}
          title="Gündem"
          accessory={
            <button type="button" className="red-link" onClick={() => void makeAgenda()} disabled={agendaLoading}>
              {agendaLoading ? 'Toplanıyor…' : 'Özetle'}
            </button>
          }
        />
        <div className="px-4 pb-3.5">
          {agenda ? (
            <>
              <p className="line-clamp-2 text-[12px] leading-relaxed text-white/65">{agenda.headline}</p>
              <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-white/30">
                <span>{agenda.items.length} gelişme</span>
                <span>{formatRelative(agenda.createdAt)}</span>
              </div>
            </>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-white/35">
              {greeting()}! Gündemini Google Arama ile toplayıp sesli özetleyebilirim.
            </p>
          )}
        </div>
      </Panel>

      {/* Son projeler */}
      <Panel>
        <CardHeader
          icon={<FolderOpen size={14} />}
          title="Son Projeler"
          accessory={
            <button type="button" className="red-link" onClick={() => setView('projects')}>
              Tümünü Gör
            </button>
          }
        />
        <div className="px-2 pb-2">
          {projects.slice(0, 5).map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setView('projects')}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <IconChip size="sm">
                {project.icon === 'code' ? <FileText size={13} /> : project.icon === 'note' ? <FileText size={13} /> : <FolderOpen size={13} />}
              </IconChip>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-white/75">{project.name}</p>
                <p className="truncate text-[10px] text-white/30">{project.description || 'Proje'}</p>
              </div>
              <span className="shrink-0 text-[10px] text-white/25">{formatRelative(project.lastOpenedAt ?? project.updatedAt)}</span>
            </button>
          ))}
          {projects.length === 0 ? (
            <p className="px-2 py-2 text-[11.5px] text-white/30">Henüz proje yok.</p>
          ) : null}
        </div>
      </Panel>

      {/* İzinler */}
      <Panel>
        <CardHeader icon={<Shield size={14} />} title="İzin Durumu" accessory={<span className="text-[10px] text-white/25">{config?.permissions.mode === 'full' ? 'tam yetki' : config?.permissions.mode === 'smart' ? 'akıllı' : 'manuel'}</span>} />
        <div className="space-y-0.5 px-4 pb-3">
          {[
            { key: 'fileAccess' as const, label: 'Dosya erişimi', icon: FileText },
            { key: 'appControl' as const, label: 'Uygulama kontrolü', icon: MonitorPlay },
            { key: 'microphone' as const, label: 'Mikrofon', icon: Mic },
            { key: 'camera' as const, label: 'Kamera', icon: Camera },
          ].map((row) => {
            const Icon = row.icon;
            const enabled = Boolean(permissions?.[row.key]);
            return (
              <div key={row.key} className="flex items-center gap-2 py-1.5">
                <Icon size={13} className={cn(enabled ? 'text-white/50' : 'text-white/25')} />
                <span className="flex-1 text-[12px] text-white/60">{row.label}</span>
                <span className={cn('mr-1 text-[10.5px]', enabled ? 'text-emerald-300/80' : 'text-white/25')}>{enabled ? 'Aktif' : 'Kapalı'}</span>
                <Toggle checked={enabled} onChange={() => togglePermission(row.key)} label={row.label} />
              </div>
            );
          })}
        </div>
      </Panel>
    </aside>
  );
}
