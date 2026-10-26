import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachBus, emitConfig, emitToast } from './core/bus';
import {
  getApiKey,
  getConfig,
  maskedApiKey,
  providerKey,
  providerStates,
  publicConfig,
  resetConfig,
  setApiKey,
  setProviderKey,
  setProviderModel,
  updateConfig,
} from './core/config';
import { log, readAudit, readRecentLogs } from './core/logger';
import { assetPath, dataDir, desktopDir, documentsDir, downloadsDir, homeDir, paths } from './core/paths';
import { resolveConfirmation, rejectAllConfirmations } from './core/security';
import { chat, stopAll, runAgenda } from './services/agent';
import {
  addFileRecord,
  addMemory,
  addReminder,
  addTask,
  createProject,
  deleteConversation,
  deleteFileRecord,
  deleteMemory,
  deleteProject,
  deleteReminder,
  deleteTask,
  exportBackup,
  getMessages,
  importBackup,
  listConversations,
  listDelegations,
  listDigests,
  listFiles,
  listMemories,
  listProjects,
  listReminders,
  listTasks,
  newConversation,
  renameConversation,
  resetAll,
  toggleTask,
  updateProject,
} from './core/db';
import { uid } from './core/store';
import { listAgentSpecs } from './services/delegation';
import { toolCatalog } from './services/tools';
import { closeApp, openApp, runningProcesses, listApps } from './services/apps';
import {
  getSystemInfo,
  mediaControl,
  openPath,
  openUrl,
  powerAction,
  readClipboard,
  setBrightness,
  setMuted,
  setVolume,
  showInFolder,
  takeScreenshot,
  writeClipboard,
} from './services/system';
import { speak } from './services/voice';
import { getCredential, listCredentials, saveCredential, deleteCredential } from './core/vault';
import { syncModels } from './services/models';
import { getTool } from './services/tools';
import { startScheduler, stopScheduler, runAgendaNow } from './services/scheduler';
import { listModels, testConnection } from './core/gemini';
import { listProviderModels, testProvider } from './core/llm';
import type { Attachment, Config, ProviderId } from '../shared/types';

/* ------------------------------------------------------------------ */
/* Uygulama kurulumu                                                   */
/* ------------------------------------------------------------------ */

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/**
 * Üretimde arayüz `file://` yerine `app://` şemasından yüklenir.
 * `file://` güvenli bağlam sayılmadığı için Chromium mikrofon erişimini
 * (getUserMedia) engelleyebiliyor; kayıtlı `app://` şeması secure + standard
 * olduğundan sesli komutlar güvenilir çalışır.
 */
const APP_SCHEME = 'app';
const APP_HOST = 'falcon';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

const DIST_ROOT = path.join(__dirname, '..', 'dist');

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      const resolved = path.normalize(path.join(DIST_ROOT, pathname));
      if (!resolved.startsWith(DIST_ROOT)) {
        return new Response('Yasak', { status: 403 });
      }
      const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : path.join(DIST_ROOT, 'index.html');
      return net.fetch(pathToFileURL(target).toString());
    } catch (err) {
      log.error('app:// isteği başarısız', err);
      return new Response('Bulunamadı', { status: 404 });
    }
  });
}
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

app.setName('Falcon AI');
if (process.platform === 'win32') app.setAppUserModelId('com.falconai.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Pencere                                                             */
/* ------------------------------------------------------------------ */

function windowStatePath(): string {
  return paths.window();
}

function loadWindowState(): { width: number; height: number; x?: number; y?: number; maximized?: boolean } {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')) as { width: number; height: number; x?: number; y?: number; maximized?: boolean };
    if (raw.width && raw.height) return raw;
  } catch {
    /* ilk açılış */
  }
  return { width: 1380, height: 920 };
}

function saveWindowState(): void {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() }),
      'utf8',
    );
  } catch {
    /* yoksay */
  }
}

function createWindow(): void {
  const state = loadWindowState();
  const icon = nativeImage.createFromPath(assetPath('falcon-mark.png'));

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    backgroundColor: '#050506',
    icon: icon.isEmpty() ? undefined : icon,
    title: 'Falcon AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (state.maximized) mainWindow?.maximize();
    const cfg = getConfig();
    if (cfg.general.startMinimized || process.argv.includes('--hidden')) {
      // arka planda başlat
    } else {
      mainWindow?.show();
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  mainWindow.on('close', (event) => {
    const cfg = getConfig();
    if (!quitting && cfg.general.closeToTray) {
      event.preventDefault();
      saveWindowState();
      mainWindow?.hide();
      if (process.platform === 'darwin') app.dock?.hide();
      return;
    }
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL as string)) return;
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  attachBus(mainWindow);
  mainWindow.webContents.on('did-finish-load', () => {
    attachBus(mainWindow as BrowserWindow);
    setTimeout(() => {
      emitConfig(publicConfig());
      void primeModels();
    }, 900);
  });

  mainWindow.on('show', () => {
    app.dock?.show();
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ------------------------------------------------------------------ */
/* Tepsi simgesi                                                       */
/* ------------------------------------------------------------------ */

function createTray(): void {
  const iconPath = assetPath('falcon-mark.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(assetPath('falcon-logo.png'));
  if (image.isEmpty()) return;
  image = image.resize({ width: 22, height: 22 });
  tray = new Tray(image);
  tray.setToolTip('Falcon — sesli yapay zekâ ajanı');
  const menu = Menu.buildFromTemplate([
    { label: 'Falcon\'u aç', click: () => showWindow() },
    { label: 'Sesli komut (mikrofon)', click: () => { showWindow(); mainWindow?.webContents.send('falcon:focus-mic'); } },
    { type: 'separator' },
    {
      label: 'Gündem özetini getir',
      click: () => {
        showWindow();
        void runAgendaNow(true).catch((err) => emitToast('error', 'Gündem alınamadı', String(err)));
      },
    },
    { label: 'Acil durdurma', click: () => stopAll() },
    { type: 'separator' },
    { label: 'Ayarlar', click: () => { showWindow(); mainWindow?.webContents.send('falcon:navigate', 'settings'); } },
    { label: 'Günlükleri aç', click: () => void shell.openPath(paths.logs()) },
    { label: 'Veri klasörünü aç', click: () => void shell.openPath(dataDir()) },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        quitting = true;
        stopScheduler();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
  tray.on('click', () => showWindow());
}

/* ------------------------------------------------------------------ */
/* Global kısayollar & otomatik başlatma                              */
/* ------------------------------------------------------------------ */

function registerShortcuts(): void {
  const cfg = getConfig();
  globalShortcut.unregisterAll();
  const toggle = cfg.general.globalShortcut;
  if (toggle) {
    const ok = globalShortcut.register(toggle, () => {
      if (!mainWindow) return createWindow();
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        showWindow();
        mainWindow.webContents.send('falcon:focus-mic');
      }
    });
    if (!ok) log.warn(`global kısayol kaydedilemedi: ${toggle}`);
  }
  const stop = cfg.general.emergencyShortcut;
  if (stop) {
    const ok = globalShortcut.register(stop, () => {
      stopAll();
      showWindow();
      mainWindow?.webContents.send('falcon:emergency-stop');
    });
    if (!ok) log.warn(`acil durdurma kısayolu kaydedilemedi: ${stop}`);
  }
}

function applyLoginItem(): void {
  const cfg = getConfig();
  if (process.platform === 'linux') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: cfg.general.launchAtLogin,
      args: cfg.general.startMinimized ? ['--hidden'] : [],
    });
  } catch (err) {
    log.warn('otomatik başlatma ayarlanamadı', err);
  }
}

async function primeModels(): Promise<void> {
  if (!providerKey('gemini')) return;
  try {
    const result = await syncModels(false);
    if (result.changed.length) {
      log.info('modeller uyarlandı', result.changed.join(', '));
      emitConfig(publicConfig());
    }
  } catch (err) {
    log.warn('model eşitleme başarısız', err);
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  /* --- Ayar --- */
  ipcMain.handle('config:get', () => publicConfig());
  ipcMain.handle('config:update', (_e, patch: Partial<Config>) => {
    const before = getConfig();
    const cfg = updateConfig(patch);
    if (patch.general) {
      registerShortcuts();
      applyLoginItem();
    }
    if (before.permissions.mode !== cfg.permissions.mode) {
      log.info(`izin modu: ${cfg.permissions.mode}`);
    }
    const pub = publicConfig();
    emitConfig(pub);
    return pub;
  });
  ipcMain.handle('config:set-key', async (_e, key: string) => {
    const cfg = setApiKey(key);
    emitConfig(cfg);
    if (getApiKey()) {
      void primeModels();
      void syncModels(true).catch(() => undefined);
    }
    return publicConfig();
  });
  ipcMain.handle('config:masked-key', () => maskedApiKey());
  ipcMain.handle('config:set-provider-key', (_e, provider: ProviderId, key: string) => {
    const cfg = setProviderKey(provider, key);
    emitConfig(cfg);
    return publicConfig();
  });
  ipcMain.handle('config:set-provider-model', (_e, provider: ProviderId, model: string) => {
    const cfg = setProviderModel(provider, model);
    emitConfig(cfg);
    return publicConfig();
  });
  ipcMain.handle('config:provider-states', () => providerStates());
  ipcMain.handle('config:test-provider', async (_e, provider: ProviderId) => {
    const result = await testProvider(provider);
    return result;
  });
  ipcMain.handle('config:provider-models', async (_e, provider: ProviderId) => {
    try {
      return await listProviderModels(provider);
    } catch (err) {
      log.warn(`model listesi alınamadı (${provider})`, err);
      throw err;
    }
  });
  ipcMain.handle('config:test', async () => {
    const result = await testConnection();
    if (result.ok) void primeModels();
    return result;
  });
  ipcMain.handle('config:models', async (_e, force = false) => {
    try {
      return await listModels(force);
    } catch (err) {
      log.warn('model listesi hatası', err);
      return [];
    }
  });
  ipcMain.handle('config:reset', () => {
    resetConfig();
    const pub = publicConfig();
    emitConfig(pub);
    return pub;
  });

  /* --- Sohbet --- */
  ipcMain.handle('chat:send', async (_e, request) => {
    return await chat(request);
  });
  ipcMain.handle('chat:stop', () => {
    stopAll();
  });
  ipcMain.handle('chat:list', () => listConversations());
  ipcMain.handle('chat:messages', (_e, id: string) => getMessages(id));
  ipcMain.handle('chat:new', (_e, title?: string) => {
    const conv = newConversation(title ?? 'Yeni sohbet');
    return conv;
  });
  ipcMain.handle('chat:remove', (_e, id: string) => deleteConversation(id));
  ipcMain.handle('chat:rename', (_e, id: string, title: string) => renameConversation(id, title));
  ipcMain.handle('chat:clear', () => resetAll());
  ipcMain.handle('chat:export', async (_e, id: string) => {
    const messages = getMessages(id);
    if (!messages.length) return null;
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Sohbeti kaydet',
      defaultPath: path.join(documentsDir(), `Falcon Sohbet ${new Date().toISOString().slice(0, 10)}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return null;
    const lines = [`# Falcon Sohbeti`, '', `_${new Date().toLocaleString('tr-TR')}_`, ''];
    for (const m of messages) {
      if (m.role === 'user') lines.push(`## 🧑 Kullanıcı`, '', String(m.text ?? ''), '');
      else if (m.role === 'assistant') lines.push(`## 🦅 Falcon`, '', String(m.text ?? ''), '');
      else if (m.role === 'tool') lines.push(`- \`${m.tool?.label ?? m.tool?.name}\`: ${m.tool?.detail ?? ''}`);
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return filePath;
  });

  /* --- Ses --- */
  ipcMain.handle('voice:speak', async (_e, text: string, voice?: string) => {
    return await speak(text, { voice });
  });
  ipcMain.handle('voice:transcribe', async (_e, audio: string, mime: string, hint?: string) => {
    const { speechToText } = await import('./services/voice');
    return await speechToText(audio, mime, { hint });
  });
  ipcMain.handle('voice:mic-permission', async () => {
    if (process.platform === 'darwin') {
      try {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') return true;
        return await systemPreferences.askForMediaAccess('microphone');
      } catch {
        return false;
      }
    }
    return true;
  });

  /* --- Sistem --- */
  ipcMain.handle('system:info', () => getSystemInfo());
  ipcMain.handle('system:power', async (_e, action: string, delay?: number) => {
    return await powerAction(action as never, delay ?? 30);
  });
  ipcMain.handle('system:volume', (_e, level: number) => setVolume(level));
  ipcMain.handle('system:muted', (_e, muted: boolean) => setMuted(muted));
  ipcMain.handle('system:media', (_e, action: string) => mediaControl(action as never));
  ipcMain.handle('system:brightness', (_e, level: number) => setBrightness(level));
  ipcMain.handle('system:screenshot', async (_e, question?: string) => {
    if (question) {
      const tool = getTool('capture_screen');
      const res = await tool?.handler({ question }, { agent: 'Falcon' });
      const data = (res?.data ?? {}) as { file?: string };
      return { file: data.file, text: res?.content ?? res?.summary };
    }
    const shot = await takeScreenshot();
    return { file: shot.file };
  });
  ipcMain.handle('system:clipboard-read', () => readClipboard());
  ipcMain.handle('system:clipboard-write', (_e, text: string) => writeClipboard(text));
  ipcMain.handle('system:open-path', (_e, target: string) => openPath(target));
  ipcMain.handle('system:open-url', (_e, url: string) => openUrl(url));
  ipcMain.handle('system:reveal', (_e, target: string) => showInFolder(target));
  ipcMain.handle('system:apps', () => listApps());
  ipcMain.handle('system:running', () => runningProcesses());
  ipcMain.handle('system:open-app', (_e, name: string) => openApp(name).then((r) => r.opened));
  ipcMain.handle('system:close-app', (_e, name: string) => closeApp(name));
  ipcMain.handle('system:notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  /* --- Veriler --- */
  ipcMain.handle('data:projects', () => listProjects());
  ipcMain.handle('data:project-create', (_e, input) => createProject(input));
  ipcMain.handle('data:project-update', (_e, id: string, patch) => updateProject(id, patch));
  ipcMain.handle('data:project-delete', (_e, id: string) => deleteProject(id));
  ipcMain.handle('data:tasks', () => listTasks());
  ipcMain.handle('data:task-add', (_e, input) => addTask(input));
  ipcMain.handle('data:task-toggle', (_e, id: string, done?: boolean) => toggleTask(id, done));
  ipcMain.handle('data:task-delete', (_e, id: string) => deleteTask(id));
  ipcMain.handle('data:reminders', () => listReminders());
  ipcMain.handle('data:reminder-add', (_e, input) => addReminder(input));
  ipcMain.handle('data:reminder-delete', (_e, id: string) => deleteReminder(id));
  ipcMain.handle('data:memories', () => listMemories());
  ipcMain.handle('data:memory-add', (_e, text: string, tags?: string[]) => addMemory(text, tags ?? []));
  ipcMain.handle('data:memory-delete', (_e, id: string) => deleteMemory(id));
  ipcMain.handle('data:files', () => listFiles());
  ipcMain.handle('data:file-delete', (_e, id: string) => deleteFileRecord(id));
  ipcMain.handle('data:agenda-latest', () => listDigests()[0] ?? null);
  ipcMain.handle('data:agenda-history', () => listDigests());
  ipcMain.handle('data:agenda-run', async (_e, speakIt = true) => {
    const digest = await runAgenda(speakIt);
    return digest.digest;
  });
  ipcMain.handle('data:audit', (_e, limit = 200) => readAudit(limit));
  ipcMain.handle('data:delegations', () => listDelegations());
  ipcMain.handle('data:tools', () => toolCatalog());
  ipcMain.handle('data:agents', () => listAgentSpecs());
  ipcMain.handle('data:backup', async () => {
    const file = exportBackup();
    await shell.openPath(path.dirname(file));
    return file;
  });
  ipcMain.handle('data:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Falcon yedeği seç',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    return importBackup(filePaths[0]);
  });
  ipcMain.handle('data:reset', () => resetAll());
  ipcMain.handle('data:credentials', () => listCredentials().map((c) => ({ id: c.id, name: c.name, username: c.username, app: c.app })));
  ipcMain.handle('data:credential-save', (_e, input) => saveCredential(input));
  ipcMain.handle('data:credential-delete', (_e, name: string) => deleteCredential(name));
  ipcMain.handle('data:credential-get', (_e, name: string) => {
    const cred = getCredential(name);
    return cred ? { name: cred.meta.name, username: cred.meta.username } : null;
  });

  /* --- Dosyalar --- */
  ipcMain.handle('files:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Falcon\'a dosya ekle',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Belgeler', extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'xlsx'] },
        { name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: 'Ses', extensions: ['mp3', 'wav', 'm4a', 'ogg'] },
        { name: 'Tümü', extensions: ['*'] },
      ],
    });
    if (canceled) return [];
    const attachments: Attachment[] = [];
    for (const file of filePaths) {
      try {
        const stat = fs.statSync(file);
        const { mimeFor } = await import('./services/documents');
        const mime = mimeFor(file);
        const attachment: Attachment = {
          id: uid('att-'),
          name: path.basename(file),
          path: file,
          size: stat.size,
          mime,
        };
        if (mime.startsWith('image/') && stat.size < 8 * 1024 * 1024) {
          attachment.dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
        }
        addFileRecord({ name: attachment.name, path: file, mime, size: stat.size });
        attachments.push(attachment);
      } catch (err) {
        log.warn('dosya eklenemedi', file, err);
      }
    }
    return attachments;
  });
  ipcMain.handle('files:pick-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return canceled ? null : filePaths[0];
  });
  ipcMain.handle('files:save-text', async (_e, suggestedName: string, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Kaydet',
      defaultPath: path.join(documentsDir(), suggestedName || 'falcon.txt'),
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content, 'utf8');
    addFileRecord({ name: path.basename(filePath), path: filePath, mime: 'text/plain', size: Buffer.byteLength(content) });
    return filePath;
  });
  ipcMain.handle('files:stat', async (_e, target: string) => {
    const { statPath } = await import('./services/documents');
    return statPath(target);
  });
  ipcMain.handle('files:home', () => ({
    home: homeDir(),
    documents: documentsDir(),
    desktop: desktopDir(),
    downloads: downloadsDir(),
  }));

  /* --- Pencere --- */
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:always-on-top', (_e, value: boolean) => mainWindow?.setAlwaysOnTop(value));
  ipcMain.handle('window:show', () => showWindow());

  /* --- Onaylar --- */
  ipcMain.handle('confirm:respond', (_e, id: string, approved: boolean) => resolveConfirmation(id, approved));

  /* --- Uygulama --- */
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:platform', () => process.platform);
  ipcMain.handle('app:logs', () => readRecentLogs(400));
  ipcMain.handle('app:open-logs', () => void shell.openPath(paths.logs()));
  ipcMain.handle('app:restart', () => {
    quitting = true;
    app.relaunch();
    app.quit();
  });
  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });
}

/* ------------------------------------------------------------------ */
/* Yaşam döngüsü                                                       */
/* ------------------------------------------------------------------ */

const gotSingleLock = gotLock;

if (gotSingleLock) {
  app.on('ready', () => {
    log.info(`Falcon başladı · sürüm ${app.getVersion()} · ${process.platform}`);
    Menu.setApplicationMenu(null);
    registerAppProtocol();

    // Mikrofon/kamera izinleri: yalnızca kendi penceremiz için, yalnızca medya
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const name = String(permission);
      const cfg = getConfig();
      if (name === 'media' || name === 'audioCapture' || name === 'microphone') {
        return callback(cfg.permissions.microphone);
      }
      if (name === 'videoCapture' || name === 'camera') return callback(cfg.permissions.camera);
      const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'background-sync'];
      callback(allowed.includes(name));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      const name = String(permission);
      if (name === 'media' || name === 'audioCapture' || name === 'microphone') return getConfig().permissions.microphone;
      if (name === 'videoCapture' || name === 'camera') return getConfig().permissions.camera;
      return ['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'background-sync'].includes(name);
    });

    createWindow();
    createTray();
    registerIpc();
    registerShortcuts();
    applyLoginItem();
    startScheduler();

    screen.on('display-metrics-changed', () => {
      mainWindow?.webContents.send('falcon:event', { type: 'config', config: publicConfig() });
    });
    powerMonitor.on('suspend', () => {
      log.info('sistem uyku moduna geçti');
      mainWindow?.webContents.send('falcon:event', { type: 'state', state: { status: 'idle' } });
    });
    powerMonitor.on('resume', () => {
      log.info('sistem uyandı');
      void primeModels();
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !getConfig().general.closeToTray) {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    stopScheduler();
    rejectAllConfirmations();
    saveWindowState();
    globalShortcut.unregisterAll();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

process.on('uncaughtException', (err) => {
  log.error('yakalanmamış hata', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('işlenmemiş promise reddi', reason);
});

export { mainWindow };
