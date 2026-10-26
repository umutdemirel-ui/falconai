import { useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import logo from '../assets/falcon-mark.png';
import { api } from './lib/api';
import { useStore } from './lib/store';
import { voiceEngine } from './lib/voice';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { RightRail } from './components/RightRail';
import { VoicePanel } from './components/VoicePanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts } from './components/Toasts';
import { Onboarding } from './components/Onboarding';
import { ChatView } from './views/ChatView';
import { ProjectsView } from './views/ProjectsView';
import { FilesView } from './views/FilesView';
import { VoiceView } from './views/VoiceView';
import { ToolsView } from './views/ToolsView';
import { SettingsView } from './views/SettingsView';

function Loading() {
  return (
    <div className="app-bg flex h-full w-full flex-col items-center justify-center gap-4">
      <img src={logo} alt="Falcon" className="h-24 w-24 animate-pulse-slow object-contain drop-shadow-[0_0_40px_rgba(255,45,45,0.6)]" />
      <div className="text-center">
        <p className="font-display text-[18px] font-bold tracking-[0.18em] text-white/85">FALCON</p>
        <p className="mt-1 text-[11px] text-white/30">hazırlanıyor…</p>
      </div>
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const config = useStore((s) => s.config);
  const view = useStore((s) => s.view);
  const init = useStore((s) => s.init);
  const applyEvent = useStore((s) => s.applyEvent);
  const voice = useStore((s) => s.voice);
  const setVoicePanelOpen = useStore((s) => s.setVoicePanelOpen);
  const voicePanelOpen = useStore((s) => s.voicePanelOpen);
  const initialized = useRef(false);

  /* İlk yükleme */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void init().catch((err) => {
      console.error('[falcon] başlatma hatası', err);
      useStore.getState().pushToast({
        kind: 'error',
        title: 'Falcon başlatılamadı',
        body: err instanceof Error ? err.message : String(err),
      });
    });
  }, [init]);

  /* Ana süreç olayları */
  useEffect(() => {
    const offEvent = api.onEvent((event) => {
      if (event.type === 'config') {
        useStore.setState({ config: event.config });
        return;
      }
      applyEvent(event);
    });
    const offConfirm = api.onConfirm((request) => useStore.getState().setConfirm(request));
    const offResolved = api.onConfirmResolved(({ id, approved }) => {
      const current = useStore.getState().confirm;
      if (current?.id === id) useStore.getState().setConfirm(null);
      if (approved) useStore.getState().pushToast({ kind: 'success', title: 'Onaylandı' });
    });
    const offNavigate = api.onNavigate((route) => {
      const map: Record<string, 'chat' | 'projects' | 'files' | 'voice' | 'tools' | 'settings'> = {
        chat: 'chat',
        projects: 'projects',
        files: 'files',
        voice: 'voice',
        tools: 'tools',
        settings: 'settings',
      };
      useStore.getState().setView(map[route] ?? 'chat');
    });
    const offMic = api.onFocusMic(() => {
      void voiceEngine.startListening('push');
    });
    const offStop = api.onEmergencyStop(() => {
      voiceEngine.stopSpeaking();
      void useStore.getState().stop();
    });
    return () => {
      offEvent();
      offConfirm();
      offResolved();
      offNavigate();
      offMic();
      offStop();
    };
  }, [applyEvent]);

  /* Ses: mikrofondan gelen metin → sohbet */
  useEffect(() => {
    voiceEngine.onTranscript((text, meta) => {
      const store = useStore.getState();
      void store.send(text, { voice: meta.voice }).finally(() => {
        store.setVoicePanelOpen(false);
      });
    });
  }, []);

  /* Ses: ana süreç "seslendir" dediğinde */
  useEffect(() => {
    const handler = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (text) void voiceEngine.speak(text, { force: true });
    };
    window.addEventListener('falcon:speak', handler);
    return () => window.removeEventListener('falcon:speak', handler);
  }, []);

  /* Klavye kısayolları */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (useStore.getState().voice.listening) void voiceEngine.finishListening();
        else void voiceEngine.startListening('push');
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void useStore.getState().newChat();
      }
      if (e.key === 'Escape') {
        voiceEngine.stopSpeaking();
        const state = useStore.getState();
        if (state.voicePanelOpen) setVoicePanelOpen(false);
        if (state.busy) void state.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setVoicePanelOpen]);

  if (!ready) return <Loading />;
  if (config && !config.onboardingDone) return <Onboarding />;

  return (
    <div className="app-bg flex h-full w-full flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-1">
        <Sidebar />
        {view === 'chat' ? <ChatView /> : null}
        {view === 'projects' ? <ProjectsView /> : null}
        {view === 'files' ? <FilesView /> : null}
        {view === 'voice' ? <VoiceView /> : null}
        {view === 'tools' ? <ToolsView /> : null}
        {view === 'settings' ? <SettingsView /> : null}
        {view === 'chat' ? <RightRail /> : null}
      </div>

      {/* mikrofon göstergesi (sol alt, panel kapalıyken) */}
      {!voicePanelOpen && (voice.listening || voice.transcribing) ? (
        <button
          type="button"
          onClick={() => setVoicePanelOpen(true)}
          className="fixed bottom-4 left-[268px] z-40 flex items-center gap-2 rounded-full border border-falcon-500/40 bg-falcon-600/20 px-3 py-2 text-[11.5px] text-falcon-100 shadow-[0_0_28px_-10px_rgba(255,47,47,0.9)] backdrop-blur"
        >
          {voice.listening ? <Mic size={13} className="animate-pulse" /> : <MicOff size={13} />}
          {voice.transcribing ? 'Yazıya dökülüyor…' : 'Dinliyorum…'}
        </button>
      ) : null}

      <VoicePanel />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
