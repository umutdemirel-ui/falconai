import { listModels, pickBestModel, clearModelCache, type ModelPurpose } from '../core/gemini';
import { getConfig, updateConfig } from '../core/config';
import { log } from '../core/logger';
import { emitConfig, emitToast } from '../core/bus';
import { publicConfig } from '../core/config';

/**
 * Model eşitleme: Google hesabında hangi modeller etkinse ayarları ona uyarlar.
 * Böylece Falcon, model adları değişse bile (gemini-3 → gemini-3.8 gibi)
 * kullanıcı hiçbir ayar yapmadan çalışmaya devam eder.
 */

const PURPOSES: { key: 'brain' | 'fast' | 'vision' | 'tts' | 'stt' | 'search'; purpose: ModelPurpose }[] = [
  { key: 'brain', purpose: 'brain' },
  { key: 'fast', purpose: 'fast' },
  { key: 'vision', purpose: 'vision' },
  { key: 'tts', purpose: 'tts' },
  { key: 'stt', purpose: 'stt' },
  { key: 'search', purpose: 'search' },
];

export async function syncModels(notify = false): Promise<{ changed: string[]; models: string[] }> {
  const cfg = getConfig();
  clearModelCache();
  let models;
  try {
    models = await listModels(true);
  } catch (err) {
    log.warn('model listesi alınamadı', err);
    return { changed: [], models: [] };
  }
  const available = new Set(models.map((m) => m.name));
  const changed: string[] = [];
  const patch: Record<string, string> = {};

  for (const { key, purpose } of PURPOSES) {
    const current = cfg.models[key];
    // TTS modelleri yalnızca tts amaçlı, diğerleri yalnızca metin modelleri olmalı
    if (key === 'tts') {
      if (available.has(current)) continue;
      const ttsModel =
        models.find((m) => /tts/.test(m.name) && /3\.8/.test(m.name))?.name ??
        models.find((m) => /tts/.test(m.name))?.name ??
        current;
      if (ttsModel !== current) {
        patch[key] = ttsModel;
        changed.push(`tts → ${ttsModel}`);
      }
      continue;
    }
    if (available.has(current)) continue;
    const best = pickBestModel(purpose, models.filter((m) => !/tts|embedding|image|veo|imagen/.test(m.name)));
    if (best && best !== current) {
      patch[key] = best;
      changed.push(`${key} → ${best}`);
    }
  }

  if (Object.keys(patch).length) {
    updateConfig({ models: { ...cfg.models, ...patch } });
    log.info('modeller güncellendi', changed.join(', '));
    if (notify) {
      emitToast('info', 'Modeller uyarlandı', `Hesabınızda bulunan modeller kullanılacak: ${changed.join(', ')}`);
    }
    emitConfig(publicConfig());
  }
  return { changed, models: models.map((m) => m.name) };
}
