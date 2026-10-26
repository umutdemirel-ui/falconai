import { useState } from 'react';
import {
  AppWindow,
  Code2,
  Download,
  FileSearch,
  KeyRound,
  MonitorPlay,
  Newspaper,
  Plus,
  Square,
} from 'lucide-react';
import logo from '../../assets/falcon-mark.png';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { VoiceOrb } from '../components/VoiceOrb';
import { Button, IconChip, StatusDot } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { voiceEngine } from '../lib/voice';
import { greeting } from '../lib/utils';

const CHIPS = [
  { icon: FileSearch, label: 'Bir dosyayı analiz et', draft: 'Bu dosyayı analiz et ve özetle: ' },
  { icon: Code2, label: 'Python kodu yaz', draft: 'Python ile şunu yaz: ' },
  { icon: Newspaper, label: 'Ders notu hazırla', draft: 'Şu konuda ders notu hazırla: ' },
  { icon: MonitorPlay, label: 'Bilgisayarımda bir işlem yap', draft: 'Bilgisayarımda şunu yap: ' },
];

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const busy = useStore((s) => s.busy);
  const setDraft = useStore((s) => s.setDraft);
  const setView = useStore((s) => s.setView);
  const setSettingsTab = useStore((s) => s.setSettingsTab);
  const newChat = useStore((s) => s.newChat);
  const pushToast = useStore((s) => s.pushToast);
  const voice = useStore((s) => s.voice);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const config = useStore((s) => s.config);
  const agentState = useStore((s) => s.agentState);
  const agenda = useStore((s) => s.agenda);
  const runAgenda = useStore((s) => s.runAgenda);
  const [exporting, setExporting] = useState(false);

  const active = conversations.find((c) => c.id === activeId);
  const hasMessages = messages.length > 0;

  const startVoice = () => {
    if (voice.listening) void voiceEngine.finishListening();
    else if (voice.speaking) voiceEngine.stopSpeaking();
    else void voiceEngine.startListening('push');
  };

  const exportChat = async () => {
    if (!activeId) return;
    setExporting(true);
    try {
      const path = await api.chat.export(activeId);
      if (path) pushToast({ kind: 'success', title: 'Sohbet kaydedildi', body: path });
    } catch (err) {
      pushToast({ kind: 'error', title: 'Kaydedilemedi', body: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="panel panel-red relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* üst şerit */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.05] px-5 py-3">
        <IconChip size="sm">
          <AppWindow size={14} />
        </IconChip>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white/85">{active?.title ?? 'Sohbet'}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-white/35">
            <StatusDot tone={busy ? 'red' : 'green'} pulse={busy} />
            {busy
              ? agentState.status === 'tool'
                ? `Araç çalışıyor${agentState.activeTool ? ` · ${agentState.activeTool}` : ''}`
                : 'Falcon düşünüyor…'
              : voice.listening
                ? 'Dinliyorum…'
                : `${config?.models.brain ?? 'Gemini'} · hazır`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {busy ? (
            <Button variant="danger" size="sm" onClick={() => void useStore.getState().stop()}>
              <Square size={12} className="fill-current" /> Durdur
            </Button>
          ) : null}
          <button type="button" className="icon-btn" title="Gündemi getir" onClick={() => void runAgenda(true)}>
            <Newspaper size={15} />
          </button>
          <button type="button" className="icon-btn" title="Sohbeti dışa aktar" onClick={() => void exportChat()} disabled={!hasMessages || exporting}>
            <Download size={15} />
          </button>
          <button type="button" className="icon-btn" title="Yeni sohbet" onClick={() => void newChat()}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {config && !config.hasApiKey ? (
        <div className="mx-5 mt-3 flex items-center gap-2.5 rounded-xl border border-falcon-500/40 bg-falcon-600/12 px-3.5 py-2.5">
          <KeyRound size={15} className="shrink-0 text-falcon-300" />
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-white/70">
            Falcon’un çalışması için bir yapay zekâ API anahtarı gerekiyor: Gemini, OpenAI, Anthropic, NVIDIA veya Abacus. Hangisini istersen ekle.
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setSettingsTab('ai');
              setView('settings');
            }}
          >
            Anahtar ekle
          </Button>
        </div>
      ) : null}

      {hasMessages ? (
        <div className="mx-auto flex min-h-0 w-full max-w-[840px] flex-1 flex-col px-5 pt-3">
          <MessageList messages={messages} busy={busy} />
          <div className="shrink-0 pb-3 pt-2">
            <Composer compact />
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center px-6 py-6">
            <img
              src={logo}
              alt="Falcon"
              className="h-[142px] w-[142px] animate-float object-contain drop-shadow-[0_0_50px_rgba(255,45,45,0.55)]"
              draggable={false}
            />
            <h2 className="mt-1 text-center font-display text-[30px] font-bold leading-tight tracking-tight text-white title-glow">
              Merhaba! Ben <span className="text-falcon-500">Falcon.</span>
            </h2>
            <p className="mt-2.5 max-w-[440px] text-center text-[13.5px] leading-relaxed text-white/50">
              Sorularını sor, görevlerini ver, ben hallederim.
              <br />
              Yapay zekâ, kod, dosya, ses ve daha fazlası…
            </p>

            <div className="mt-6">
              <VoiceOrb
                listening={voice.listening}
                speaking={voice.speaking}
                thinking={busy}
                level={voice.level}
                onToggle={startVoice}
                onStopSpeaking={() => voiceEngine.stopSpeaking()}
                hint={
                  voice.transcribing
                    ? 'Konuşman yazıya dökülüyor…'
                    : voice.listening
                      ? 'Konuşmayı bitirdiğinde komutun otomatik gönderilir'
                      : `${greeting()}${config?.userName ? ` ${config.userName}` : ''}, mikrofona basıp konuşabilirsin`
                }
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setDraft(chip.draft);
                      window.dispatchEvent(new CustomEvent('falcon:focus-composer'));
                    }}
                  >
                    <Icon size={14} className="text-falcon-300/80" />
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {agenda ? (
              <div className="mt-4 flex max-w-[560px] items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-falcon-500/25 bg-falcon-600/15 text-falcon-300">
                  <Newspaper size={12} />
                </span>
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-white/45">{agenda.headline}</p>
                <button type="button" className="red-link shrink-0" onClick={() => setView('tools')}>
                  Gündem
                </button>
              </div>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-4">
            <Composer />
          </div>
        </div>
      )}
    </section>
  );
}
