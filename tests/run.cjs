#!/usr/bin/env node
/**
 * Falcon arka uç entegrasyon testi.
 *
 * Gerçek `dist-electron/main.cjs` dosyasını yükler. Electron çekirdeği
 * (tests/harness/electron-stub.cjs) ve Gemini API (tests/harness/gemini-mock.cjs)
 * taklit edilir; böylece ekran/GPU olmadan tüm ana süreç mantığı sınanır:
 * ayar şifreleme, model keşfi, ajan araç döngüsü, TTS/STT, veri katmanı, gündem.
 *
 * Kullanım:  npm run test:backend
 */
process.env.FALCON_DEBUG = process.env.FALCON_DEBUG ?? '1';
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const STUB = path.join(__dirname, 'harness', 'electron-stub.cjs');
const USER_DATA = process.env.FALCON_TEST_USERDATA || path.join(os.tmpdir(), `falcon-test-${process.pid}`);
process.env.FALCON_TEST_USERDATA = USER_DATA;
// Sanal ev dizini: araçların yazdığı her şey burada kalır, gerçek dosyalara dokunulmaz.
const FAKE_HOME = path.join(USER_DATA, 'home');
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;

// 'electron' isteklerini taklide yönlendir
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return STUB;
  return originalResolve.call(this, request, ...args);
};

const { server, requests, getPort } = require('./harness/gemini-mock.cjs');

const isWindows = process.platform === 'win32';
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) results.push(`✅ ${name}`);
  else {
    failures++;
    results.push(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = getPort();
  const realFetch = global.fetch;
  global.fetch = (url, init) =>
    realFetch(String(url).replace('https://generativelanguage.googleapis.com', `http://127.0.0.1:${port}`), init);

  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });

  const electron = require(STUB);
  const readyPromise = new Promise((resolve) => electron.app.once('ready', resolve));
  require(path.join(ROOT, 'dist-electron', 'main.cjs'));
  electron.app.emit('ready');
  await readyPromise;
  await new Promise((r) => setTimeout(r, 350));

  const handlers = electron.__test.ipcHandlers;
  const invoke = async (channel, ...args) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`IPC kanalı bulunamadı: ${channel}`);
    return handler({ sender: { send() {} } }, ...args);
  };

  check('IPC kanalları kaydedildi', handlers.size > 40, `${handlers.size} kanal`);

  /* ----------------------------- Ayarlar ----------------------------- */
  const config = await invoke('config:get');
  check('Varsayılan ayarlar yüklendi', config?.permissions?.mode === 'full');
  check('Başlangıçta API anahtarı yok', config.hasApiKey === false);
  check('Varsayılan modeller Gemini', /^gemini-/.test(config.models.brain) && /tts/.test(config.models.tts));

  let badKeyRejected = false;
  try {
    await invoke('config:set-key', 'kisa');
  } catch {
    badKeyRejected = true;
  }
  check('Geçersiz anahtar reddedildi', badKeyRejected && (await invoke('config:get')).hasApiKey === false);

  const afterKey = await invoke('config:set-key', 'AIzaSyTESTKEY1234567890abcdefghijklmn');
  check('Geçerli anahtar kaydedildi', afterKey.hasApiKey === true);
  const rawConfig = fs.readFileSync(path.join(USER_DATA, 'falcon-data', 'config.json'), 'utf8');
  check('Anahtar diske şifreli yazıldı', !rawConfig.includes('AIzaSyTESTKEY') && rawConfig.includes('enc:'));
  const masked = await invoke('config:masked-key');
  check('Anahtar arayüze maskelenmiş gider', masked.startsWith('AIza') && masked.includes('••'));

  const models = await invoke('config:models', true);
  check('Model listesi alındı', Array.isArray(models) && models.length >= 5, `${models.length} model`);
  const test = await invoke('config:test');
  check('Bağlantı testi başarılı', test.ok === true, test.message);

  const updated = await invoke('config:update', { userName: 'Umut', voice: { voice: 'Puck' } });
  check(
    'Ayar güncelleme iç içe birleştiriyor',
    updated.userName === 'Umut' && updated.voice.voice === 'Puck' && Boolean(updated.models.brain),
  );

  /* ------------------------------ Sohbet ----------------------------- */
  const chat = await invoke('chat:send', { text: 'Sistem durumunu kontrol et ve bana özetle' });
  check('Sohbet yanıtı döndü', Boolean(chat.conversationId && chat.assistantMessage));
  check('Ajan akışlı istek yaptı', requests.some((r) => r.url.includes('streamGenerateContent')));
  const messages = await invoke('chat:messages', chat.conversationId);
  const toolMessage = messages.find((m) => m.role === 'tool');
  check('Araç mesajı kaydedildi', Boolean(toolMessage), messages.map((m) => m.role).join(','));
  check('Araç başarıyla çalıştı', toolMessage?.tool?.status === 'ok', toolMessage?.tool?.detail);
  check(
    'Nihai yanıt üretildi',
    typeof chat.assistantMessage.text === 'string' && chat.assistantMessage.text.length > 5,
    chat.assistantMessage.text,
  );
  const auditEntries = await invoke('data:audit', 50);
  check('Denetim kaydı yazıldı', auditEntries.some((a) => a.tool === 'system_info'));

  /* ------------------------------- Ses ------------------------------- */
  const spoken = await invoke('voice:speak', 'Merhaba Umut, bugün harika bir gün olacak.');
  check('Gemini TTS ses üretti', Boolean(spoken.audioBase64 && spoken.audioBase64.length > 100));
  const wav = Buffer.from(spoken.audioBase64, 'base64');
  check('TTS çıktısı geçerli WAV', wav.subarray(0, 4).toString('ascii') === 'RIFF' && wav.length > 44);

  const transcript = await invoke('voice:transcribe', wav.toString('base64'), 'audio/wav', 'test');
  check('Ses yazıya çevrildi', typeof transcript.text === 'string' && transcript.text.length > 3, transcript.text);

  /* ------------------------------ Sistem ----------------------------- */
  const info = await invoke('system:info');
  check('Sistem bilgisi alındı', Boolean(info?.platformLabel) && info.cores > 0);
  const clip = await invoke('system:clipboard-read');
  check('Pano okunabiliyor', typeof clip === 'string');

  /* ------------------------------ Veriler ---------------------------- */
  const project = await invoke('data:project-create', { name: 'Test Projesi', description: 'deneme' });
  check('Proje oluşturuldu', project.name === 'Test Projesi');
  check('Proje listelendi', (await invoke('data:projects')).some((p) => p.id === project.id));

  const task = await invoke('data:task-add', { title: 'Test görevi' });
  await invoke('data:task-toggle', task.id, true);
  check('Görev eklenip tamamlandı', (await invoke('data:tasks')).find((t) => t.id === task.id)?.done === true);

  const reminder = await invoke('data:reminder-add', { text: 'Su iç', dailyAt: '09:00' });
  check('Hatırlatıcı eklendi', Boolean(reminder.id));

  const memory = await invoke('data:memory-add', 'Kullanıcı akşamları kod yazmayı seviyor', ['tercih']);
  check('Hafıza eklendi', Boolean(memory.id) && (await invoke('data:memories')).length === 1);

  const digest = await invoke('data:agenda-run', false);
  check('Gündem özeti üretildi', digest.items.length >= 1, digest.headline);
  check('Gündem kaynağı eklendi', digest.items[0].source?.uri === 'https://example.com/a');

  /* ------------------------------ Araçlar ---------------------------- */
  const toolList = await invoke('data:tools');
  check('Araç kataloğu dolu', toolList.length >= 30, `${toolList.length} araç`);
  check('Alt ajanlar tanımlı', (await invoke('data:agents')).length === 4);

  /* --------------------------- Dosya sistemi ------------------------- */
  const home = await invoke('files:home');
  check('Klasör yolları alındı', Boolean(home.documents && home.desktop));

  /* ------------------- Gerçek araçlar (dosya sistemi) ----------------- */
  const toolChat = async (name, args, text = 'Araç testi') => {
    const payload = Buffer.from(JSON.stringify({ name, args })).toString('base64');
    const res = await invoke('chat:send', { text: `${text} #TOOLCALL:${payload}#` });
    const msgs = await invoke('chat:messages', res.conversationId);
    return msgs.filter((m) => m.role === 'tool').at(-1);
  };

  const workDir = path.join(FAKE_HOME, 'Documents');
  fs.mkdirSync(workDir, { recursive: true });
  const targetFile = path.join(workDir, 'falcon-test.txt');

  const writeTool = await toolChat('write_file', { path: targetFile, content: 'Merhaba Falcon, bu bir test dosyasıdır.\nİkinci satır.' });
  check('write_file gerçekten dosya yazdı', fs.existsSync(targetFile) && fs.readFileSync(targetFile, 'utf8').includes('İkinci satır'), writeTool?.tool?.detail);

  const readTool = await toolChat('read_file', { path: targetFile });
  check('read_file dosya içeriğini döndürdü', (readTool?.tool?.output ?? '').includes('Merhaba Falcon'), readTool?.tool?.status);

  const listTool = await toolChat('list_directory', { path: workDir });
  check('list_directory içerik listeliyor', (listTool?.tool?.output ?? '').includes('falcon-test.txt'));

  const searchTool = await toolChat('search_files', { query: 'falcon-test', root: workDir });
  check('search_files dosyayı buldu', (searchTool?.tool?.output ?? '').includes('falcon-test.txt'));

  const noteTool = await toolChat('save_note', { title: 'Falcon Test Notu', content: 'Bu not otomatik test tarafından oluşturuldu.' });
  check('save_note dosya kaydetti', fs.existsSync(path.join(workDir, 'Falcon Notları', 'Falcon Test Notu.md')), noteTool?.tool?.detail);

  const cmdTool = await toolChat('run_command', { command: 'echo merhaba-falcon' });
  check('run_command gerçekten çalıştı', (cmdTool?.tool?.output ?? '').includes('merhaba-falcon') || isWindows, cmdTool?.tool?.output);

  const cwdTool = await toolChat('run_command', { command: isWindows ? 'Get-Location' : 'pwd', cwd: workDir });
  check('run_command cwd klasöründe çalıştı', (cwdTool?.tool?.output ?? '').includes(workDir), cwdTool?.tool?.output);

  const blockedCmd = await toolChat('run_command', { command: 'mkfs.ext4 /dev/sda1' });
  check('Kara listedeki komut engellendi', blockedCmd?.tool?.status === 'error' && (blockedCmd?.tool?.output ?? '').includes('Güvenlik'), blockedCmd?.tool?.detail);

  const escapeWrite = await toolChat('write_file', { path: '/etc/falcon-hack.conf', content: 'x' });
  check('Sistem klasörüne yazma engellendi', escapeWrite?.tool?.status === 'error' && (escapeWrite?.tool?.output ?? '').includes('Güvenlik'), escapeWrite?.tool?.detail);

  const copyTool = await toolChat('copy_path', { from: targetFile, to: path.join(workDir, 'kopya.txt') });
  check('copy_path kopyaladı', fs.existsSync(path.join(workDir, 'kopya.txt')), copyTool?.tool?.detail);

  /* ---------------------------- Onay akışı --------------------------- */
  await invoke('config:update', { permissions: { mode: 'smart' } });
  const deletePayload = Buffer.from(JSON.stringify({ name: 'delete_path', args: { path: path.join(workDir, 'kopya.txt') } })).toString('base64');
  const deletePromise = invoke('chat:send', { text: `Dosyayı sil #TOOLCALL:${deletePayload}#` });
  // Onay isteğini yakala
  let confirmRequest = null;
  for (let i = 0; i < 60 && !confirmRequest; i++) {
    await new Promise((r) => setTimeout(r, 50));
    confirmRequest = electron.__test.sentEvents.filter((e) => e.channel === 'falcon:confirm').at(-1)?.payload ?? null;
  }
  check('Riskli işlem için onay istendi', Boolean(confirmRequest?.id), confirmRequest?.tool);
  if (confirmRequest) {
    await invoke('confirm:respond', confirmRequest.id, true);
  }
  const deleteResult = await deletePromise;
  const deleteMsgs = await invoke('chat:messages', deleteResult.conversationId);
  const deleteTool = deleteMsgs.filter((m) => m.role === 'tool').at(-1);
  check(
    'Onaylanan silme işlemi uygulandı',
    deleteTool?.tool?.status === 'ok' && (deleteTool?.tool?.detail ?? '').includes('Çöp kutusuna'),
    deleteTool?.tool?.detail,
  );
  await invoke('config:update', { permissions: { mode: 'full' } });

  /* --------------------------- Hafıza aracı -------------------------- */
  const rememberTool = await toolChat('remember', { text: 'Kullanıcı yerel model değil Gemini kullanmayı tercih ediyor.', tags: ['tercih'] });
  check('remember aracı hafızaya yazdı', rememberTool?.tool?.status === 'ok' && (await invoke('data:memories')).length >= 2);

  /* ------------------------ İzin işleyicileri ------------------------ */
  const sessionState = electron.__test.sessionState;
  check('İzin istek işleyicisi kaydedildi', typeof sessionState?.permissionRequestHandler === 'function');

  await invoke('config:update', { permissions: { microphone: false } });
  let granted = null;
  sessionState.permissionRequestHandler({}, 'media', (value) => (granted = value));
  check('Mikrofon kapalıyken medya izni reddedildi', granted === false, String(granted));

  await invoke('config:update', { permissions: { microphone: true } });
  granted = null;
  sessionState.permissionRequestHandler({}, 'media', (value) => (granted = value));
  check('Mikrofon açıkken medya izni verildi', granted === true, String(granted));

  granted = null;
  sessionState.permissionRequestHandler({}, 'geolocation', (value) => (granted = value));
  check('Bilinmeyen izin reddedildi', granted === false, String(granted));

  /* -------------------------- Sistem önbelleği ----------------------- */
  const sysA = await invoke('system:info');
  const sysB = await invoke('system:info');
  check('Sistem bilgisi alındı', typeof sysA?.hostname === 'string' && sysA?.cores > 0);
  check(
    'Sistem bilgisi önbellekten döndü',
    sysB?.uptimeSec === sysA?.uptimeSec && sysB?.freeMemGb === sysA?.freeMemGb,
    `${sysA?.uptimeSec} / ${sysB?.uptimeSec}`,
  );

  /* ----------------------------- Özet ------------------------------- */
  const eventTypes = new Set(electron.__test.sentEvents.map((e) => e.payload?.type).filter(Boolean));
  check('Arayüze olaylar iletildi', eventTypes.has('message') && eventTypes.has('delta'), [...eventTypes].join(','));

  console.log('\n=== FALCON ARKA UÇ ENTEGRASYON TESTİ ===\n');
  for (const line of results) console.log(line);
  console.log(`\n${results.length - failures}/${results.length} test geçti`);
  console.log(`Gemini taklit istekleri: ${requests.length} · arayüze olay: ${electron.__test.sentEvents.length}`);
  console.log(`Olay tipleri: ${[...eventTypes].join(', ')}`);

  server.close();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('TEST HATASI', err);
  process.exit(1);
});
