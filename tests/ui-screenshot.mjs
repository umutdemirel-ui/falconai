#!/usr/bin/env node
/**
 * Arayüz ekran görüntüsü aracı (isteğe bağlı).
 *
 * Tarayıcı önizlemesini (demo veri katmanı) başsız Chromium ile açar ve
 * docs/screenshots klasörüne görüntü kaydeder.
 *
 * Gereksinimler (proje bağımlılığı değildir):
 *   npm i -D puppeteer-core @sparticuz/chromium
 *   veya CHROME_PATH=/yol/chrome npm run test:ui
 *
 * Sunucu: `npm run preview` ayrı bir terminalde çalışıyor olmalı.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'screenshots');
const BASE = process.env.FALCON_PREVIEW_URL ?? 'http://127.0.0.1:4173/';

let puppeteer;
let executablePath = process.env.CHROME_PATH;
try {
  puppeteer = (await import('puppeteer-core')).default;
  if (!executablePath) {
    const chromium = (await import('@sparticuz/chromium')).default;
    executablePath = await chromium.executablePath();
  }
} catch {
  console.error(
    'puppeteer-core veya @sparticuz/chromium bulunamadı.\n' +
      'Kurulum: npm i -D puppeteer-core @sparticuz/chromium\n' +
      'veya CHROME_PATH ortam değişkeniyle Chrome yolunu belirtin.',
  );
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb'],
  defaultViewport: { width: 1380, height: 920, deviceScaleFactor: 1 },
});

const views = [
  { file: 'sohbet.png', nav: null },
  { file: 'ana-ekran.png', nav: 'new' },
  { file: 'projeler.png', nav: 'Projeler' },
  { file: 'dosyalar.png', nav: 'Dosyalar' },
  { file: 'sesli-asistan.png', nav: 'Sesli Asistan' },
  { file: 'bilgisayar-araclari.png', nav: 'Bilgisayar Araçları' },
  { file: 'ayarlar.png', nav: 'Ayarlar' },
  { file: 'saglayicilar.png', nav: 'Ayarlar', click: 'API ve Modeller' },
  { file: 'saglayicilar-ollama.png', nav: 'Ayarlar', click: 'API ve Modeller', scrollTo: 'Ollama (yerel)' },
];

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1400));

for (const view of views) {
  if (view.nav === 'new') {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.title === 'Yeni sohbet');
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 800));
  } else if (view.nav) {
    await page.evaluate((label) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      btn?.click();
    }, view.nav);
    await new Promise((r) => setTimeout(r, 800));
  }
  if (view.click) {
    await page.evaluate((label) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      btn?.click();
    }, view.click);
    await new Promise((r) => setTimeout(r, 800));
  }
  if (view.scrollTo) {
    await page.evaluate((needle) => {
      const card = [...document.querySelectorAll('div')].find(
        (el) => el.childElementCount > 0 && el.textContent.trim().startsWith(needle) && el.textContent.length < 600,
      );
      card?.scrollIntoView({ block: 'center' });
    }, view.scrollTo);
    await new Promise((r) => setTimeout(r, 600));
  }
  await page.screenshot({ path: path.join(OUT, view.file) });
  console.log(`kaydedildi: docs/screenshots/${view.file}`);
}

await page.goto(`${BASE}?onboarding=1`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(OUT, 'kurulum.png') });
console.log('kaydedildi: docs/screenshots/kurulum.png');

// Onboarding 2. adım: sağlayıcı seçimi (yerel Ollama dahil)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Devam'));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(OUT, 'kurulum-saglayici.png') });
console.log('kaydedildi: docs/screenshots/kurulum-saglayici.png');

await browser.close();
