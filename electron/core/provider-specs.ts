import type { ProviderId, ProviderKind } from '../../shared/types';

/** Sağlayıcıların değişmeyen tanımları (anahtar/ayar tutmaz). */
export interface ProviderSpec {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Resmî API kök adresi */
  baseUrl: string;
  /** Anahtar yoksa kullanılan varsayılan model */
  defaultModel: string;
  /** Model bulunamazsa sırayla denenecek modeller */
  fallbackModels: string[];
  keyHint: string;
  docsUrl: string;
  supportsVoice: boolean;
  supportsVision: boolean;
  note: string;
}

export const PROVIDER_SPECS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash',
    fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
    keyHint: 'AIza…',
    docsUrl: 'https://aistudio.google.com/apikey',
    supportsVoice: true,
    supportsVision: true,
    note: 'Ses (TTS/STT), görsel analiz ve Google Arama destekli gündem için önerilir.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6',
    fallbackModels: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-4o-mini'],
    keyHint: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys',
    supportsVoice: true,
    supportsVision: true,
    note: 'Sohbet + araç kullanımı + Whisper ile ses yazıya dökme + doğal seslendirme.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
    fallbackModels: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-5'],
    keyHint: 'sk-ant-…',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    supportsVoice: false,
    supportsVision: true,
    note: 'Uzun belgeler ve kod için güçlü. Ses özellikleri Gemini veya OpenAI ile çalışır.',
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    kind: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    fallbackModels: [
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
      'nvidia/nemotron-3-super-120b-a12b',
      'openai/gpt-oss-120b',
    ],
    keyHint: 'nvapi-…',
    docsUrl: 'https://build.nvidia.com',
    supportsVoice: false,
    supportsVision: true,
    note: 'Ücretsiz geliştirici kotası. Model adları “üretici/model” biçimindedir.',
  },
  abacus: {
    id: 'abacus',
    label: 'Abacus AI (RouteLLM)',
    kind: 'openai',
    baseUrl: 'https://routellm.abacus.ai/v1',
    defaultModel: 'route-llm',
    fallbackModels: ['gpt-6-astra', 'claude-sonnet-5', 'gemini-3.8-flash'],
    keyHint: 'Abacus API anahtarı',
    docsUrl: 'https://abacus.ai/help/route-llm/',
    supportsVoice: false,
    supportsVision: true,
    note: 'Tek anahtarla 150+ model; “route-llm” isteğe göre en uygun modeli seçer.',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['gemini', 'openai', 'anthropic', 'nvidia', 'abacus'];

export function providerSpec(id: ProviderId): ProviderSpec {
  return PROVIDER_SPECS[id] ?? PROVIDER_SPECS.gemini;
}
