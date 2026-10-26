import { safeStorage } from 'electron';
import { log } from './logger';

/**
 * Gizli değerlerin (API anahtarları) diskte şifrelenmesi.
 *
 * Mümkünse işletim sisteminin anahtar zinciri (DPAPI / Keychain / libsecret)
 * kullanılır. Kullanılamıyorsa değer en azından düz metin olarak yazılmaz;
 * base64 ile kodlanır ve günlüğe uyarı düşülür.
 */

export function encryptSecret(raw: string): string {
  const value = raw.trim();
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(value).toString('base64')}`;
    }
    log.warn('safeStorage kullanılamıyor; gizli değer temel kodlama ile saklandı.');
  } catch (err) {
    log.warn('gizli değer şifrelenemedi', err);
  }
  return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    }
    // Eski format: düz metin
    return stored;
  } catch (err) {
    log.error('gizli değer çözülemedi', err);
    return '';
  }
}

export function maskSecret(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
