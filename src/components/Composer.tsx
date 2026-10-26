import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, MonitorUp, Paperclip, Send, X } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { voiceEngine } from '../lib/voice';
import { cn, formatBytes } from '../lib/utils';

export function Composer({ compact = false }: { compact?: boolean }) {
  const draft = useStore((s) => s.draft);
  const setDraft = useStore((s) => s.setDraft);
  const attachments = useStore((s) => s.attachments);
  const addAttachments = useStore((s) => s.addAttachments);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const send = useStore((s) => s.send);
  const busy = useStore((s) => s.busy);
  const voice = useStore((s) => s.voice);
  const pushToast = useStore((s) => s.pushToast);
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener('falcon:focus-composer', focus);
    return () => window.removeEventListener('falcon:focus-composer', focus);
  }, []);

  const submit = () => {
    if (busy) return;
    if (!draft.trim() && attachments.length === 0) return;
    void send();
  };

  const pickFiles = async () => {
    try {
      const items = await api.files.pick();
      if (items.length) addAttachments(items);
    } catch (err) {
      pushToast({ kind: 'error', title: 'Dosya eklenemedi', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const screenshot = async () => {
    try {
      const shot = await api.system.screenshot();
      if (shot.file) {
        addAttachments([
          {
            id: `shot-${Date.now()}`,
            name: 'Ekran görüntüsü.png',
            mime: 'image/png',
            size: 0,
            path: shot.file,
          },
        ]);
        pushToast({ kind: 'success', title: 'Ekran görüntüsü eklendi' });
      }
    } catch (err) {
      pushToast({ kind: 'error', title: 'Ekran görüntüsü alınamadı', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const toggleMic = () => {
    if (voice.listening) void voiceEngine.finishListening();
    else void voiceEngine.startListening('push');
  };

  return (
    <div className={cn('w-full', compact ? '' : 'max-w-[720px]')}>
      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-2 pr-1.5 text-[11.5px] text-white/70"
            >
              <FileText size={13} className="text-falcon-300" />
              <span className="max-w-[160px] truncate">{att.name}</span>
              {att.size ? <span className="text-white/30">{formatBytes(att.size)}</span> : null}
              <button type="button" className="icon-btn h-5 w-5" onClick={() => removeAttachment(att.id)} aria-label="Kaldır">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-2 rounded-2xl border bg-ink-850/90 px-3 py-2.5 backdrop-blur-xl transition-all duration-200',
          focus ? 'border-falcon-500/45 shadow-[0_0_34px_-18px_rgba(255,47,47,0.9)]' : 'border-white/[0.09]',
        )}
      >
        <div className="flex items-center gap-0.5 pb-0.5">
          <button type="button" className="icon-btn h-8 w-8" onClick={() => void pickFiles()} title="Dosya ekle" aria-label="Dosya ekle">
            <Paperclip size={16} />
          </button>
          <button type="button" className="icon-btn h-8 w-8" onClick={() => void screenshot()} title="Ekran görüntüsü ekle" aria-label="Ekran görüntüsü">
            <MonitorUp size={16} />
          </button>
        </div>

        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={voice.listening ? 'Dinliyorum… konuşman bittiğinde yazıya dökülecek' : 'Mesajını yaz… (Chrome’u aç, dosyayı özetle, gündemi getir)'}
          className="max-h-[132px] min-h-[30px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-relaxed text-white/90 outline-none placeholder:text-white/25"
        />

        <div className="flex items-center gap-1.5 pb-0.5">
          <button
            type="button"
            onClick={toggleMic}
            title={voice.listening ? 'Kaydı bitir' : 'Sesli komut'}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full border transition-all',
              voice.listening
                ? 'border-falcon-400/70 bg-falcon-600/30 text-falcon-100 shadow-[0_0_22px_-6px_rgba(255,47,47,0.95)]'
                : 'border-white/10 bg-white/[0.04] text-white/50 hover:border-falcon-400/40 hover:text-falcon-200',
            )}
          >
            <Mic size={16} className={voice.listening ? 'animate-pulse' : ''} />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (!draft.trim() && attachments.length === 0)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-all',
              busy || (!draft.trim() && attachments.length === 0)
                ? 'bg-white/[0.06] text-white/25'
                : 'bg-gradient-to-b from-falcon-500 to-falcon-700 text-white shadow-[0_0_24px_-8px_rgba(255,47,47,1)] hover:brightness-110',
            )}
            aria-label="Gönder"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[10.5px] text-white/25">
        <span>Falcon bilgisayarında tam yetkiyle çalışır · tüm veriler cihazında kalır</span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="kbd">Enter</span> gönder
          <span className="kbd">Shift+Enter</span> satır
        </span>
      </div>
    </div>
  );
}
