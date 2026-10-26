import { useEffect, useState } from 'react';
import { AudioLines, Mic, Radio, Settings2, Sparkles, Volume2, Waves } from 'lucide-react';
import { useStore } from '../lib/store';
import { voiceEngine } from '../lib/voice';
import { Button, Field, IconChip, Panel, Segmented, Select, Slider, Toggle } from '../components/ui';
import { VoiceOrb } from '../components/VoiceOrb';
import { MicTestPanel } from '../components/MicTestPanel';
import { cn } from '../lib/utils';

const GEMINI_VOICES = [
  { name: 'Kore', label: 'Kore · kadın, sıcak' },
  { name: 'Puck', label: 'Puck · erkek, enerjik' },
  { name: 'Charon', label: 'Charon · erkek, derin' },
  { name: 'Zephyr', label: 'Zephyr · kadın, parlak' },
  { name: 'Fenrir', label: 'Fenrir · erkek, güçlü' },
  { name: 'Leda', label: 'Leda · kadın, genç' },
  { name: 'Orus', label: 'Orus · erkek, kararlı' },
  { name: 'Aoede', label: 'Aoede · kadın, yumuşak' },
];

const WAKE_SUGGESTIONS = ['Falcon', 'Hey Falcon', 'Falcon dinle'];

export function VoiceView() {
  const config = useStore((s) => s.config);
  const voice = useStore((s) => s.voice);
  const busy = useStore((s) => s.busy);
  const saveConfig = useStore((s) => s.saveConfig);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    void voiceEngine.devices().then(setDevices);
    void voiceEngine.systemVoices().then(setSystemVoices);
  }, []);

  if (!config) return null;
  const v = config.voice;

  const preview = async () => {
    setPreviewing(true);
    try {
      await voiceEngine.preview('Merhaba, ben Falcon. Bugün senin için ne yapabilirim?');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <section className="panel panel-red flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-3.5">
        <IconChip size="sm">
          <Mic size={14} />
        </IconChip>
        <div className="flex-1">
          <h2 className="text-[13.5px] font-semibold text-white/90">Sesli Asistan</h2>
          <p className="text-[10.5px] text-white/35">Konuş, Falcon dinlesin; yanıtları doğal sesle okusun</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void preview()} disabled={previewing || v.engine === 'off'}>
          <Volume2 size={13} /> {previewing ? 'Konuşuyor…' : 'Sesi dinle'}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 lg:grid-cols-2 [&>*]:min-w-0 [&>*]:self-start">
        {/* Sol: canlı asistan */}
        <div className="space-y-4">
          <Panel className="relative overflow-hidden p-6">
            <div className="pointer-events-none absolute inset-0 bg-radial-red opacity-70" />
            <div className="relative flex flex-col items-center gap-5">
              <VoiceOrb
                listening={voice.listening}
                speaking={voice.speaking}
                thinking={busy}
                level={voice.level}
                onToggle={() => {
                  if (voice.listening) void voiceEngine.finishListening();
                  else if (voice.speaking) voiceEngine.stopSpeaking();
                  else void voiceEngine.startListening(v.continuousListening ? 'continuous' : 'push');
                }}
                onStopSpeaking={() => voiceEngine.stopSpeaking()}
                statusText={
                  voice.listening
                    ? 'Konuşmanı dinliyorum…'
                    : voice.transcribing
                      ? 'Yazıya döküyorum…'
                      : voice.speaking
                        ? 'Sana cevap veriyorum'
                        : 'Konuşmaya hazırım'
                }
                hint={
                  voice.listening
                    ? 'Sustuğunda komut otomatik gönderilir'
                    : `Örnek: “Falcon, Chrome’u aç ve gündemi özetle”`
                }
              />

              <div className="w-full rounded-xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
                <p className="label mb-1.5">Son duyulan</p>
                <p className={cn('min-h-[38px] text-[12.5px] leading-relaxed', voice.transcript ? 'text-white/85' : 'text-white/30')}>
                  {voice.transcript || 'Henüz bir konuşma yok.'}
                </p>
              </div>

              {voice.error ? (
                <div className="w-full rounded-xl border border-falcon-500/30 bg-falcon-500/[0.08] px-3 py-2">
                  <p className="text-[9.5px] uppercase tracking-wide text-falcon-200/80">Ses hatası</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/75">{voice.error}</p>
                  <button
                    type="button"
                    onClick={() => useStore.getState().setVoice({ error: undefined })}
                    className="mt-1.5 text-[10px] text-falcon-200/80 underline decoration-dotted hover:text-falcon-100"
                  >
                    Kapat
                  </button>
                </div>
              ) : null}

              <div className="grid w-full grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-[10px] text-white/30">Ses motoru</p>
                  <p className="mt-0.5 text-[12px] font-medium text-white/75">
                    {v.engine === 'gemini' ? `Gemini · ${v.voice}` : v.engine === 'system' ? 'Sistem sesi' : 'Kapalı'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p className="text-[10px] text-white/30">Sürekli dinleme</p>
                  <p className={cn('mt-0.5 text-[12px] font-medium', v.continuousListening ? 'text-emerald-300/90' : 'text-white/50')}>
                    {v.continuousListening ? 'Açık' : 'Kapalı'}
                  </p>
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Radio size={14} className="text-falcon-400" />
              <span className="flex-1 text-[12.5px] font-semibold text-white/85">Uyandırma sözcüğü</span>
              <Toggle
                checked={v.wakeWordEnabled}
                onChange={(value) =>
                  void saveConfig({
                    voice: { ...v, wakeWordEnabled: value, continuousListening: value ? true : v.continuousListening },
                  })
                }
              />
            </div>
            <p className="text-[11px] leading-relaxed text-white/35">
              Açıkken Falcon yalnızca uyandırma sözcüğünü duyduğunda komut alır. Örn. “Falcon, Spotify’ı aç”.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Field
                value={v.wakePhrase}
                onChange={(e) => void saveConfig({ voice: { ...v, wakePhrase: e.target.value } })}
                className="w-[180px] py-1.5 text-[12px]"
                placeholder="Falcon"
              />
              {WAKE_SUGGESTIONS.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  className="chip px-2.5 py-1 text-[11px]"
                  onClick={() => void saveConfig({ voice: { ...v, wakePhrase: phrase } })}
                >
                  {phrase}
                </button>
              ))}
            </div>
          </Panel>
        </div>

        {/* Sağ: ayarlar */}
        <div className="space-y-4">
          <MicTestPanel />

          <Panel className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 size={14} className="text-falcon-400" />
              <span className="text-[12.5px] font-semibold text-white/85">Konuşma ayarları</span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="label mb-1.5">Ses motoru</p>
                <Segmented
                  value={v.engine}
                  onChange={(engine) => void saveConfig({ voice: { ...v, engine } })}
                  options={[
                    { value: 'gemini', label: 'AI sesi' },
                    { value: 'system', label: 'Sistem sesi' },
                    { value: 'off', label: 'Kapalı' },
                  ]}
                />
              </div>

              {v.engine === 'gemini' ? (
                <>
                  <div>
                    <p className="label mb-1.5">Ses sağlayıcısı</p>
                    <Select
                      value={config.ai.voiceProvider}
                      onChange={(e) => void saveConfig({ ai: { ...config.ai, voiceProvider: e.target.value as 'gemini' | 'openai' } })}
                    >
                      <option value="gemini">Google Gemini (TTS + STT)</option>
                      <option value="openai">OpenAI (gpt-4o-mini-tts + Whisper)</option>
                    </Select>
                    <p className="mt-1 text-[10.5px] text-white/25">
                      {config.ai.voiceProvider === 'openai'
                        ? 'OpenAI anahtarı gerekir; Türkçe konuşmada Whisper kullanılır.'
                        : 'Gemini anahtarı gerekir; ses, görsel ve gündem için tek anahtar yeterli.'}
                    </p>
                  </div>
                  <div>
                    <p className="label mb-1.5">Gemini sesi</p>
                    <Select value={v.voice} onChange={(e) => void saveConfig({ voice: { ...v, voice: e.target.value } })}>
                      {GEMINI_VOICES.map((voiceOption) => (
                        <option key={voiceOption.name} value={voiceOption.name}>
                          {voiceOption.name}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-[10.5px] text-white/25">{GEMINI_VOICES.find((x) => x.name === v.voice)?.label ?? ''}</p>
                  </div>
                  <div>
                    <p className="label mb-1.5">Ses tonu yönergesi</p>
                    <Field
                      value={v.style}
                      onChange={(e) => void saveConfig({ voice: { ...v, style: e.target.value } })}
                      placeholder="sıcak, kendinden emin, doğal"
                      className="text-[12px]"
                    />
                    <p className="mt-1 text-[10.5px] text-white/25">
                      Gemini’ye ton, hız ve duygu talimatı olarak gönderilir. OpenAI sesinde yönerge ses adıyla birlikte iletilir.
                    </p>
                  </div>
                </>
              ) : null}

              {v.engine === 'system' ? (
                <div>
                  <p className="label mb-1.5">Sistem sesi</p>
                  <Select value={v.systemVoiceURI} onChange={(e) => void saveConfig({ voice: { ...v, systemVoiceURI: e.target.value } })}>
                    <option value="">Otomatik (Türkçe)</option>
                    {systemVoices.map((sv) => (
                      <option key={sv.voiceURI} value={sv.voiceURI}>
                        {sv.name} ({sv.lang})
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2 border-t border-white/[0.06] pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-white/75">Yanıtları sesli oku</p>
                    <p className="text-[10.5px] text-white/30">Her yanıtı otomatik seslendir</p>
                  </div>
                  <Toggle checked={v.autoSpeak} onChange={(autoSpeak) => void saveConfig({ voice: { ...v, autoSpeak } })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-white/75">Sürekli dinle</p>
                    <p className="text-[10.5px] text-white/30">Falcon konuştuktan sonra mikrofonu tekrar açar</p>
                  </div>
                  <Toggle
                    checked={v.continuousListening}
                    onChange={(continuousListening) => void saveConfig({ voice: { ...v, continuousListening } })}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[12px] text-white/75">Sessizlikte otomatik bitir</p>
                    <p className="text-[10.5px] text-white/30">{v.vadSilenceMs} ms sessizlik sonrası gönder</p>
                  </div>
                  <Slider
                    value={v.vadSilenceMs}
                    min={400}
                    max={2500}
                    step={100}
                    onChange={(vadSilenceMs) => void saveConfig({ voice: { ...v, vadSilenceMs } })}
                    suffix=" ms"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[12px] text-white/75">Mikrofon hassasiyeti</p>
                    <p className="text-[10.5px] text-white/30">Gürültülü ortamda artır</p>
                  </div>
                  <Slider
                    value={Math.round(v.vadThreshold * 1000)}
                    min={10}
                    max={120}
                    step={5}
                    onChange={(value) => void saveConfig({ voice: { ...v, vadThreshold: value / 1000 } })}
                  />
                </div>
              </div>

              <div>
                <p className="label mb-1.5">Mikrofon</p>
                <Select value={v.micDeviceId} onChange={(e) => void saveConfig({ voice: { ...v, micDeviceId: e.target.value } })}>
                  <option value="">Varsayılan mikrofon</option>
                  {devices.map((device, i) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Mikrofon ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-falcon-400" />
              <span className="text-[12.5px] font-semibold text-white/85">Sesli komut örnekleri</span>
            </div>
            <div className="space-y-1.5">
              {[
                'Falcon, Chrome’u aç',
                'Gündemi özetle ve kaydet',
                'Bugünkü ders notumu hazırla',
                'Bilgisayarı kapat',
                'Müziği aç ve sesi yükselt',
              ].map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    void useStore.getState().send(text, { voice: true });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-left text-[11.5px] text-white/55 transition-colors hover:border-falcon-500/30 hover:text-white/85"
                >
                  <AudioLines size={12} className="shrink-0 text-falcon-400/80" />
                  {text}
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[10px] text-white/25">
              <Waves size={10} /> Falcon konuşurken mikrofona basarak sözünü kesebilirsin.
            </p>
          </Panel>
        </div>
      </div>
    </section>
  );
}
