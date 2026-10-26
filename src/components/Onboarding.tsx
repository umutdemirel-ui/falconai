import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, Mic, Shield, Sparkles } from 'lucide-react';
import logo from '../../assets/falcon-mark.png';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Field, IconChip, Panel, Segmented, Select, Toggle } from './ui';
import { cn } from '../lib/utils';

const STEPS = ['Hoş geldin', 'API anahtarı', 'İzinler', 'Ses'];

export function Onboarding() {
  const config = useStore((s) => s.config);
  const saveConfig = useStore((s) => s.saveConfig);
  const pushToast = useStore((s) => s.pushToast);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(config?.userName === 'Kullanıcı' ? '' : config?.userName ?? '');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState<null | { ok: boolean; message: string }>(null);

  if (!config) return null;

  const finish = async () => {
    await saveConfig({ onboardingDone: true });
    pushToast({ kind: 'success', title: 'Falcon hazır', body: 'Hadi başlayalım. Mikrofona basıp konuşabilirsin.' });
  };

  const saveAndTest = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setTested(null);
    try {
      const next = await api.config.setApiKey(key.trim());
      useStore.setState({ config: next });
      const result = await api.config.test();
      setTested({ ok: result.ok, message: result.message });
      if (result.ok) setStep(2);
    } catch (err) {
      setTested({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-bg flex h-full w-full items-center justify-center p-8">
      <div className="grid w-full max-w-[940px] gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="Falcon"
              className="h-16 w-16 object-contain drop-shadow-[0_0_26px_rgba(255,45,45,0.55)]"
              draggable={false}
            />
            <div>
              <h1 className="font-display text-[30px] font-extrabold tracking-[0.05em] text-white">FALCON</h1>
              <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Yapay zekâ ajanın</p>
            </div>
          </div>

          <h2 className="mt-7 font-display text-[26px] font-bold leading-tight text-white">
            Merhaba! Ben <span className="text-falcon-500">Falcon.</span>
          </h2>
          <p className="mt-2.5 max-w-[400px] text-[13px] leading-relaxed text-white/50">
            Bilgisayarında tam yetkiyle çalışan, seninle konuşan, uygulama açıp kapatan, dosyalarını okuyup yazan ve gündemi
            senin yerine takip eden kişisel yapay zekâ asistanın. Tek ihtiyacım bir Google AI anahtarı.
          </p>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {[
              { icon: Mic, title: 'Sesli komut', desc: 'Konuş, dinlesin, cevap versin' },
              { icon: Shield, title: 'Tam yetki', desc: 'Uygulama, dosya, terminal, güç' },
              { icon: Sparkles, title: 'Gemini gücü', desc: 'Gündem, analiz, yaratıcılık' },
              { icon: KeyRound, title: 'Anahtar sende', desc: 'Veriler cihazında kalır' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <IconChip size="sm">
                    <Icon size={13} />
                  </IconChip>
                  <div>
                    <p className="text-[11.5px] font-medium text-white/80">{item.title}</p>
                    <p className="text-[10px] text-white/30">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center gap-1.5">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold',
                    i < step
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300'
                      : i === step
                        ? 'border-falcon-400/60 bg-falcon-600/30 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/30',
                  )}
                >
                  {i < step ? <Check size={10} /> : i + 1}
                </span>
                <span className={cn('text-[10.5px]', i === step ? 'text-white/70' : 'text-white/25')}>{label}</span>
                {i < STEPS.length - 1 ? <span className="mx-1 h-px w-4 bg-white/10" /> : null}
              </div>
            ))}
          </div>
        </div>

        <Panel red className="p-5">
          {step === 0 ? (
            <div className="flex h-full flex-col">
              <h3 className="text-[15px] font-semibold text-white">Seni nasıl çağırayım?</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
                Falcon seninle doğal bir dille konuşur. Adını gir, sana hitap etsin.
              </p>
              <div className="mt-4">
                <label className="label mb-1.5 block">Adın</label>
                <Field
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn. Umut"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) {
                      void saveConfig({ userName: name.trim() });
                      setStep(1);
                    }
                  }}
                />
              </div>
              <div className="mt-auto flex justify-end pt-5">
                <Button
                  variant="primary"
                  disabled={!name.trim()}
                  onClick={async () => {
                    await saveConfig({ userName: name.trim() });
                    setStep(1);
                  }}
                >
                  Devam <ArrowRight size={13} />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex h-full flex-col">
              <h3 className="text-[15px] font-semibold text-white">Google AI anahtarın</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
                Falcon yalnızca Gemini API kullanır. Anahtar ücretsiz alınabilir ve yalnızca bu cihazda şifreli saklanır.
              </p>
              <div className="mt-4">
                <label className="label mb-1.5 block">API anahtarı</label>
                <Field
                  autoFocus
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="AIza…"
                  className="font-mono text-[12px]"
                />
                <button
                  type="button"
                  className="mt-2 flex items-center gap-1 text-[10.5px] text-falcon-300/80 hover:text-falcon-200"
                  onClick={() => void api.system.openUrl('https://aistudio.google.com/apikey')}
                >
                  <ExternalLink size={10} /> aistudio.google.com/apikey adresinden anahtar al
                </button>
              </div>

              {tested ? (
                <div
                  className={cn(
                    'mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed',
                    tested.ok ? 'border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-200/90' : 'border-falcon-500/35 bg-falcon-600/10 text-falcon-100',
                  )}
                >
                  {tested.message}
                </div>
              ) : null}

              <div className="mt-auto flex items-center justify-between pt-5">
                <button type="button" className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70" onClick={() => setStep(0)}>
                  <ArrowLeft size={12} /> Geri
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" className="text-[10.5px] text-white/25 hover:text-white/50" onClick={() => setStep(2)}>
                    Şimdilik atla
                  </button>
                  <Button variant="primary" onClick={() => void saveAndTest()} disabled={!key.trim() || saving}>
                    <KeyRound size={13} /> {saving ? 'Test ediliyor…' : 'Kaydet ve test et'}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex h-full flex-col">
              <h3 className="text-[15px] font-semibold text-white">Falcon’a ne kadar yetki vereceksin?</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
                Bu ayarı sonra Ayarlar → İzinler ve Güvenlik bölümünden istediğin zaman değiştirebilirsin.
              </p>
              <div className="mt-4 space-y-2">
                {[
                  { value: 'full' as const, title: 'Tam yetki', desc: 'Sormadan yapar. En akıcı deneyim.' },
                  { value: 'smart' as const, title: 'Akıllı', desc: 'Yalnızca silme, terminal ve kapatmada onay ister.' },
                  { value: 'manual' as const, title: 'Her işlemde sor', desc: 'Her araç çağrısı için onay kutusu.' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void saveConfig({ permissions: { ...config.permissions, mode: option.value } })}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                      config.permissions.mode === option.value
                        ? 'border-falcon-500/45 bg-falcon-600/12'
                        : 'border-white/[0.07] bg-white/[0.015] hover:border-white/20',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border',
                        config.permissions.mode === option.value ? 'border-falcon-400 bg-falcon-500' : 'border-white/25',
                      )}
                    >
                      {config.permissions.mode === option.value ? <Check size={9} className="text-white" /> : null}
                    </span>
                    <span>
                      <span className="block text-[12.5px] font-medium text-white/85">{option.title}</span>
                      <span className="block text-[10.5px] text-white/35">{option.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-auto flex items-center justify-between pt-5">
                <button type="button" className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70" onClick={() => setStep(1)}>
                  <ArrowLeft size={12} /> Geri
                </button>
                <Button variant="primary" onClick={() => setStep(3)}>
                  Devam <ArrowRight size={13} />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex h-full flex-col">
              <h3 className="text-[15px] font-semibold text-white">Sesini seç</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
                Falcon seninle Türkçe konuşur. İstersen susar, istersen yalnızca yazar.
              </p>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="label mb-1.5">Gemini sesi</p>
                  <Select
                    value={config.voice.voice}
                    onChange={(e) => void saveConfig({ voice: { ...config.voice, voice: e.target.value } })}
                  >
                    {['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede'].map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div>
                    <p className="text-[12px] text-white/80">Yanıtları sesli oku</p>
                    <p className="text-[10.5px] text-white/30">Gemini TTS ile doğal Türkçe ses</p>
                  </div>
                  <Toggle
                    checked={config.voice.autoSpeak}
                    onChange={(autoSpeak) => void saveConfig({ voice: { ...config.voice, autoSpeak } })}
                  />
                </div>
                <div>
                  <p className="label mb-1.5">Ses motoru</p>
                  <Segmented
                    value={config.voice.engine}
                    onChange={(engine) => void saveConfig({ voice: { ...config.voice, engine } })}
                    options={[
                      { value: 'gemini', label: 'Gemini (önerilen)' },
                      { value: 'system', label: 'Sistem sesi' },
                      { value: 'off', label: 'Sessiz' },
                    ]}
                  />
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between pt-5">
                <button type="button" className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70" onClick={() => setStep(2)}>
                  <ArrowLeft size={12} /> Geri
                </button>
                <Button variant="primary" onClick={() => void finish()}>
                  <Sparkles size={13} /> Falcon’u başlat
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
