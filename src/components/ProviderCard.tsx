import { useState } from 'react';
import { Check, ExternalLink, List, RefreshCw, Save, Star } from 'lucide-react';
import type { ProviderState } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Field, Select, StatusDot } from './ui';
import { cn } from '../lib/utils';

interface Props {
  state: ProviderState;
  primary: boolean;
  onPrimary: () => void;
}

/**
 * Tek bir yapay zekâ sağlayıcısı kartı: anahtar kaydetme, bağlantı testi,
 * model listeleme/seçme ve "sohbet için birincil yap" seçimi.
 */
export function ProviderCard({ state, primary, onPrimary }: Props) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const saveProviderKey = useStore((s) => s.saveProviderKey);
  const setProviderModel = useStore((s) => s.setProviderModel);
  const pushToast = useStore((s) => s.pushToast);

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await saveProviderKey(state.id, key.trim());
      setKey('');
      pushToast({ kind: 'success', title: `${state.label} anahtarı kaydedildi` });
      setMessage({ ok: true, text: 'Anahtar şifrelenerek kaydedildi. Şimdi bağlantıyı test edebilirsin.' });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage({ ok: false, text });
      pushToast({ kind: 'error', title: 'Anahtar kaydedilemedi', body: text });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.config.testProvider(state.id);
      setMessage({ ok: result.ok, text: result.ok ? `${result.message} ${result.latencyMs ? `(${result.latencyMs} ms)` : ''}` : result.message });
      if (result.ok) {
        pushToast({ kind: 'success', title: `${state.label} bağlı` });
        void loadModels();
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const list = await api.config.providerModels(state.id);
      setModels(list);
      if (!list.length) setMessage({ ok: false, text: 'Model listesi boş döndü.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingModels(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    try {
      await saveProviderKey(state.id, '');
      setModels([]);
      setMessage({ ok: true, text: 'Anahtar kaldırıldı.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        primary ? 'border-falcon-500/35 bg-falcon-600/[0.07]' : 'border-white/[0.06] bg-white/[0.015]',
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={state.hasKey ? 'green' : 'red'} pulse={state.hasKey && primary} />
        <span className="text-[12.5px] font-semibold text-white/85">{state.label}</span>
        {state.supportsVoice ? (
          <span className="rounded border border-white/10 px-1 py-0.5 text-[8.5px] uppercase tracking-wide text-white/30" title="Seslendirme ve ses yazıya dökme destekler">
            ses
          </span>
        ) : null}
        {state.hasKey ? (
          <span className="truncate font-mono text-[9.5px] text-white/25">{state.masked}</span>
        ) : (
          <span className="text-[9.5px] text-white/25">anahtar yok</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {primary ? (
            <span className="flex items-center gap-1 rounded-md border border-falcon-500/30 bg-falcon-600/15 px-1.5 py-0.5 text-[9px] text-falcon-200">
              <Star size={9} /> birincil
            </span>
          ) : (
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-[9.5px] text-white/30 transition-colors hover:text-falcon-200 disabled:opacity-40"
              onClick={onPrimary}
              disabled={!state.hasKey}
              title={state.hasKey ? 'Sohbet ve araçlar bu sağlayıcıyla çalışsın' : 'Önce anahtar ekleyin'}
            >
              birincil yap
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-white/25">{state.note}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[190px] flex-1">
          <Field
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            placeholder={state.hasKey ? 'Yeni anahtar…' : state.keyHint}
            className="py-1.5 pr-[76px] font-mono text-[11px]"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[9px] text-white/30 hover:text-white/70"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? 'gizle' : 'göster'}
            </button>
            {state.hasKey ? (
              <button
                type="button"
                className="rounded px-1 py-0.5 text-[9px] text-falcon-300/70 hover:text-falcon-200"
                onClick={() => void removeKey()}
                disabled={busy}
              >
                sil
              </button>
            ) : null}
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={!key.trim() || busy}>
          <Save size={11} /> {busy ? '…' : 'Kaydet'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void test()} disabled={!state.hasKey || testing}>
          <RefreshCw size={11} className={testing ? 'animate-spin' : ''} /> {testing ? 'Test…' : 'Test'}
        </Button>
        <button
          type="button"
          className="flex items-center gap-1 text-[9.5px] text-falcon-300/70 hover:text-falcon-200"
          onClick={() => void api.system.openUrl(state.docsUrl)}
        >
          <ExternalLink size={9} /> anahtar al
        </button>
      </div>

      {state.hasKey ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[190px] flex-1">
            <Select
              value={state.model || state.defaultModel}
              onChange={(e) => void setProviderModel(state.id, e.target.value)}
              className="py-1.5 text-[11px]"
              title="Bu sağlayıcıyla kullanılacak model"
            >
              {[...new Set([state.model || state.defaultModel, state.defaultModel, ...models])].filter(Boolean).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void loadModels()} disabled={loadingModels}>
            <List size={11} /> {loadingModels ? 'Modeller…' : 'Modelleri getir'}
          </Button>
        </div>
      ) : null}

      {message ? (
        <p className={cn('mt-2 flex items-start gap-1 text-[10px] leading-relaxed', message.ok ? 'text-emerald-300/80' : 'text-falcon-200/90')}>
          {message.ok ? <Check size={11} className="mt-0.5 shrink-0" /> : null}
          <span className="min-w-0 flex-1">{message.text}</span>
        </p>
      ) : null}
    </div>
  );
}
