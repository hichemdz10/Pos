const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// ── تقليل استهلاك الذاكرة على الأجهزة القديمة ──
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow, adminWindow, customerWindow;

const PRELOAD = path.join(__dirname, 'preload.js');

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 720,
    minWidth: 900, minHeight: 600,
    title: "الكاشير — مكتبة حشايشي",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD,
      // ── تقليل استهلاك الذاكرة ──
      backgroundThrottling: true,
      offscreen: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => app.quit());
}

// ── adminWindow تُفتح فقط عند الطلب من الكاشير ──
function openAdminWindow() {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus(); return;
  }
  adminWindow = new BrowserWindow({
    width: 620, height: 440,
    title: "لوحة تحكم الشاشة الخارجية",
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD
    }
  });
  adminWindow.loadFile('display-admin.html');
  adminWindow.setMenuBarVisibility(false);
  adminWindow.on('closed', () => { adminWindow = null; });
}

// ── customerWindow تُفتح فقط عند الطلب ──
function openCustomerWindow() {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.focus(); return;
  }
  const displays = screen.getAllDisplays();
  const ext = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0);

  const opts = ext
    ? { x: ext.bounds.x, y: ext.bounds.y,
        width: ext.bounds.width, height: ext.bounds.height,
        fullscreen: true }
    : { width: 900, height: 580 };

  customerWindow = new BrowserWindow({
    ...opts,
    title: ext ? "شاشة الزبون" : "شاشة الزبون (تجريبية)",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD
    }
  });
  customerWindow.loadFile('display.html');
  customerWindow.setMenuBarVisibility(false);
  customerWindow.on('closed', () => { customerWindow = null; });
}

// ══ IPC — أوامر من نافذة الكاشير ══
ipcMain.on('window:openAdmin',    () => openAdminWindow());
ipcMain.on('window:openCustomer', () => openCustomerWindow());

// ── مزامنة شاشة الزبون عبر IPC ──
ipcMain.on('display:update', (_, data) => {
  if (customerWindow && !customerWindow.isDestroyed())
    customerWindow.webContents.send('display:update', data);
  if (adminWindow && !adminWindow.isDestroyed())
    adminWindow.webContents.send('display:update', data);
});

ipcMain.on('display:config', (_, data) => {
  if (customerWindow && !customerWindow.isDestroyed())
    customerWindow.webContents.send('display:config', data);
});

app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
