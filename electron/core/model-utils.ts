/**
 * Model adı yardımcıları.
 *
 * Google, eski Gemini modellerini API'den kaldırıyor (404 NOT_FOUND). Kullanıcıların
 * ayar dosyalarında kalan emekli adlar hem gereksiz istek üretiyor hem de gerçek
 * hatayı (kota, ağ) gizliyordu. Bu yardımcılar tek bir doğruluk kaynağı sağlar.
 */

/** Emekliye ayrılmış Gemini modelleri (2.x ve öncesi). */
export const RETIRED_MODEL = /gemini-(1\.|2\.|3\.0|3-flash)/i;

export function isRetiredModel(name: string | undefined | null): boolean {
  return Boolean(name && RETIRED_MODEL.test(name));
}
