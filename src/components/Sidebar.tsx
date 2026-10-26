import { useEffect, useState } from 'react';
import {
  FileText,
  FolderOpen,
  Mic,
  Monitor,
  Plus,
  Power,
  Settings,
  SquarePen,
} from 'lucide-react';
import logo from '../../assets/falcon-mark.png';
import { api } from '../lib/api';
import { useStore, type View } from '../lib/store';
import { cn, initials } from '../lib/utils';

const NAV: { view: View; label: string; icon: typeof Mic }[] = [
  { view: 'chat', label: 'Sohbet', icon: SquarePen },
  { view: 'projects', label: 'Projeler', icon: FolderOpen },
  { view: 'files', label: 'Dosyalar', icon: FileText },
  { view: 'voice', label: 'Sesli Asistan', icon: Mic },
  { view: 'tools', label: 'Bilgisayar Araçları', icon: Monitor },
  { view: 'settings', label: 'Ayarlar', icon: Settings },
];

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const config = useStore((s) => s.config);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const selectConversation = useStore((s) => s.selectConversation);
  const newChat = useStore((s) => s.newChat);
  const voice = useStore((s) => s.voice);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void api.app.version().then(setVersion);
  }, []);

  const recent = conversations.slice(0, 3);

  return (
    <aside className="panel panel-red flex w-[248px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-5 pb-5 pt-5">
        <div className="relative">
          <img
            src={logo}
            alt="Falcon"
            className="h-[52px] w-[52px] object-contain drop-shadow-[0_0_18px_rgba(255,45,45,0.55)]"
            draggable={false}
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[25px] font-extrabold leading-none tracking-[0.06em] text-white">FALCON</h1>
          <p className="mt-1.5 truncate text-[10.5px] font-medium leading-tight text-white/35">Senin yapay zekâ asistanın</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              className={cn('nav-item', active && 'nav-item-active')}
            >
              <Icon size={17} strokeWidth={1.9} className={cn('nav-icon text-white/50 transition-colors', active && 'text-falcon-400')} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.view === 'voice' && voice.listening ? <span className="dot bg-falcon-500 animate-pulse" /> : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-4 flex items-center justify-between px-5">
        <span className="label">Son sohbetler</span>
        <button type="button" className="icon-btn h-6 w-6" onClick={() => void newChat()} aria-label="Yeni sohbet">
          <Plus size={14} />
        </button>
      </div>
      <div className="mt-1.5 flex-1 overflow-y-auto px-3 pb-2">
        {recent.length === 0 ? (
          <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-white/25">Henüz sohbet yok. Falcon’a bir şey sor.</p>
        ) : (
          recent.map((conv) => (
            <button
              key={conv.id}
              type="button"
              onClick={() => void selectConversation(conv.id)}
              className={cn(
                'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                conv.id === activeId && view === 'chat' ? 'bg-white/[0.05] text-white/90' : 'text-white/40 hover:bg-white/[0.035] hover:text-white/75',
              )}
            >
              <span className="h-1 w-1 shrink-0 rounded-full bg-falcon-500/70" />
              <span className="truncate text-[12px]">{conv.title}</span>
            </button>
          ))
        )}
      </div>

      <div className="stripe-bg mx-3 mb-3 rounded-2xl border border-falcon-500/20 bg-gradient-to-br from-falcon-900/25 to-black/40 p-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-falcon-400/40 bg-falcon-600/20 text-[12px] font-semibold text-falcon-100">
            {initials(config?.userName || 'Umut Demirel')}
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-white/90">{config?.userName || 'Kullanıcı'}</p>
            <p className="text-[10.5px] text-emerald-300/80">Çevrimiçi</p>
          </div>
          <button
            type="button"
            className="icon-btn h-7 w-7 hover:text-falcon-300"
            title="Falcon’dan çık"
            onClick={() => void api.app.quit()}
          >
            <Power size={14} />
          </button>
        </div>
        <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] text-white/25">
          <span>Falcon v{version || '1.0.0'}</span>
          <span>Google Gemini</span>
        </div>
      </div>
    </aside>
  );
}
