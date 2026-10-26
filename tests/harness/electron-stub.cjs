/**
 * Electron çekirdeği taklidi — ana süreç mantığını GUI olmadan test etmek için.
 * Yalnızca test amaçlıdır; uygulamaya dahil edilmez.
 */
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const USER_DATA = process.env.FALCON_TEST_USERDATA || '/tmp/falcon-test-userdata';
fs.mkdirSync(USER_DATA, { recursive: true });

const sentEvents = [];

class WebContents extends EventEmitter {
  constructor() {
    super();
    this.id = 1;
  }
  send(channel, payload) {
    sentEvents.push({ channel, payload, at: Date.now() });
  }
  setWindowOpenHandler() {}
  on() {
    return this;
  }
}

class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.webContents = new WebContents();
    this._bounds = { x: 0, y: 0, width: options.width || 1380, height: options.height || 920 };
    this._visible = true;
    this._maximized = false;
    BrowserWindow.instances.push(this);
    setTimeout(() => {
      this.emit('ready-to-show');
      this.emit('show');
    }, 5);
  }
  static getAllWindows() {
    return BrowserWindow.instances;
  }
  loadURL(url) {
    this.url = url;
    setTimeout(() => this.webContents.emit('did-finish-load'), 5);
    return Promise.resolve();
  }
  loadFile(file) {
    this.file = file;
    setTimeout(() => this.webContents.emit('did-finish-load'), 5);
    return Promise.resolve();
  }
  show() { this._visible = true; this.emit('show'); }
  hide() { this._visible = false; }
  focus() {}
  isDestroyed() { return false; }
  isVisible() { return this._visible; }
  isFocused() { return true; }
  isMinimized() { return false; }
  isMaximized() { return this._maximized; }
  maximize() { this._maximized = true; }
  unmaximize() { this._maximized = false; }
  restore() {}
  minimize() {}
  close() { this.emit('close', { preventDefault() {} }); }
  setAlwaysOnTop() {}
  getBounds() { return this._bounds; }
  getNormalBounds() { return this._bounds; }
}
BrowserWindow.instances = [];

class Tray extends EventEmitter {
  constructor() { super(); Tray.instance = this; }
  setToolTip() {}
  setContextMenu() {}
}

const app = new EventEmitter();
Object.assign(app, {
  getPath(name) {
    const map = {
      userData: USER_DATA,
      home: process.env.HOME || '/tmp',
      desktop: path.join(process.env.HOME || '/tmp', 'Desktop'),
      documents: path.join(process.env.HOME || '/tmp', 'Documents'),
      downloads: path.join(process.env.HOME || '/tmp', 'Downloads'),
      temp: '/tmp',
    };
    return map[name] || '/tmp';
  },
  getVersion: () => '1.0.0',
  getAppPath: () => process.env.FALCON_APP_ROOT || process.cwd(),
  isPackaged: false,
  setName() {},
  setAppUserModelId() {},
  requestSingleInstanceLock: () => true,
  setLoginItemSettings() {},
  relaunch() {},
  quit() {},
  dock: { hide() {}, show() {} },
});

let encryptionAvailable = true;
const safeStorage = {
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (text) => Buffer.concat([Buffer.from('enc::'), Buffer.from(text, 'utf8')]),
  decryptString: (buf) => buf.toString('utf8').replace(/^enc::/, ''),
};

const ipcHandlers = new Map();
const ipcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler);
  },
  on() {},
};

class Notification extends EventEmitter {
  static isSupported() { return false; }
  constructor(opts) { super(); this.opts = opts; }
  show() {}
}

const globalShortcut = {
  register: () => true,
  unregisterAll() {},
};

const screen = {
  getAllDisplays: () => [
    { id: 1, size: { width: 2560, height: 1440 }, scaleFactor: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  ],
  getPrimaryDisplay: () => ({ id: 1, size: { width: 2560, height: 1440 }, scaleFactor: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }),
  on() {},
};

const desktopCapturer = {
  getSources: async () => [
    {
      thumbnail: {
        toPNG: () => Buffer.from('fake-png'),
        getSize: () => ({ width: 2560, height: 1440 }),
      },
    },
  ],
};

const shell = {
  openPath: async () => '',
  openExternal: async () => {},
  showItemInFolder: () => {},
  trashItem: async () => {},
};

const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: '' }),
};

const clipboard = {
  readText: async () => 'test pano içeriği',
  writeText: async () => {},
};

const nativeImage = {
  createFromPath: () => ({ isEmpty: () => true, resize: () => ({ isEmpty: () => true }) }),
};

const powerMonitor = new EventEmitter();
const systemPreferences = {
  getMediaAccessStatus: () => 'granted',
  askForMediaAccess: async () => true,
};
const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: () => {} };

const sessionState = { permissionRequestHandler: null, permissionCheckHandler: null };
const session = {
  defaultSession: {
    setPermissionRequestHandler: (fn) => {
      sessionState.permissionRequestHandler = fn;
    },
    setPermissionCheckHandler: (fn) => {
      sessionState.permissionCheckHandler = fn;
    },
  },
};

module.exports = {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  session,
  ipcMain,
  safeStorage,
  globalShortcut,
  screen,
  desktopCapturer,
  shell,
  dialog,
  clipboard,
  nativeImage,
  powerMonitor,
  systemPreferences,
  __test: {
    sentEvents,
    ipcHandlers,
    sessionState,
    setEncryptionAvailable: (v) => (encryptionAvailable = v),
  },
};
