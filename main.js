/**
 * main.js
 * العملية الرئيسية لـ Electron
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── وضع المطور ───────────────────────────────────────
const isDev = !app.isPackaged;

// ── النافذة الرئيسية ─────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    title:           'مكتبة حشايشي — نظام نقطة البيع',
    backgroundColor: '#080f1e',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      true,
    },
    show: false,
  });

  // ── تحميل ذكي: تحديث OTA إن وُجد، وإلا النسخة المحزومة ──
  const ota = require('./sync/otaUpdate');
  mainWindow.loadFile(ota.getRendererPath());

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── بدء التطبيق ──────────────────────────────────────
app.whenReady().then(async () => {

  // 1. تهيئة محرك المزامنة (يُهيّئ قاعدة البيانات داخلياً تلقائياً)
  const syncEngine = require('./sync/syncEngine');
  syncEngine.init(
    (status) => {
      mainWindow?.webContents.send('sync:status', status);
      if (status.oversoldCount > 0) {
        const alerts = dbModule().getOversoldAlerts();
        mainWindow?.webContents.send('sync:oversold', alerts);
      }
    },
    (progress) => {
      mainWindow?.webContents.send('sync:bootstrap-progress', progress);
    }
  );

  // 2. جدولة النسخ الاحتياطية
  const backup = require('./sync/backup');
  backup.schedule();

  // 3. بدء فحص تحديثات الواجهة (OTA)
  const ota = require('./sync/otaUpdate');
  ota.startAutoCheck((updateInfo) => {
    // إشعار الواجهة بوجود تحديث جاهز
    mainWindow?.webContents.send('app:update-ready', updateInfo);
  });

  // 4. إنشاء النافذة
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

// ══════════════════════════════════════════════════════
//  IPC Handlers — قاعدة البيانات
// ══════════════════════════════════════════════════════
const dbModule = () => require('./database/db');

ipcMain.handle('db:getAll',              (_, table)     => dbModule().getAll(table));
ipcMain.handle('db:save',               (_, table, item)=> dbModule().save(table, item));
ipcMain.handle('db:remove',             (_, table, id)  => dbModule().remove(table, id));
ipcMain.handle('db:updateStock',        (_, id, delta)  => dbModule().updateStock(id, delta));
ipcMain.handle('db:getOversoldAlerts',  ()              => dbModule().getOversoldAlerts());
ipcMain.handle('db:markOversoldNotified',(_, ids)       => dbModule().markOversoldNotified(ids));
ipcMain.handle('db:getStats',           ()              => dbModule().getSyncStats());

// ══════════════════════════════════════════════════════
//  IPC Handlers — المزامنة
// ══════════════════════════════════════════════════════
const sync = () => require('./sync/syncEngine');

ipcMain.handle('sync:getStatus',  () => sync().getStatus());
ipcMain.handle('sync:forcePush',  () => sync().forcePush());
ipcMain.handle('sync:forcePull',  () => sync().forcePull());
ipcMain.handle('sync:bootstrap',  () => sync().bootstrap());

// ══════════════════════════════════════════════════════
//  IPC Handlers — النسخ الاحتياطي
// ══════════════════════════════════════════════════════
const bk = () => require('./sync/backup');

ipcMain.handle('backup:doNow',      () => bk().dailyBackup());
ipcMain.handle('backup:toUSB',      () => bk().backupToUSB());
ipcMain.handle('backup:list',       () => bk().listBackups());
ipcMain.handle('backup:openFolder', () => {
  const folder = path.join(app.getPath('userData'), 'Backups');
  shell.openPath(folder);
  return folder;
});

// ══════════════════════════════════════════════════════
//  IPC Handlers — OTA تحديث الواجهة
// ══════════════════════════════════════════════════════
const ota = () => require('./sync/otaUpdate');

ipcMain.handle('ota:check',    () => ota().checkRendererUpdate());
ipcMain.handle('ota:info',     () => ota().getUpdateInfo());
ipcMain.handle('ota:rollback', () => ota().rollback());
ipcMain.handle('ota:restart',  () => { app.relaunch(); app.exit(0); });

// ══════════════════════════════════════════════════════
//  IPC Handlers — معلومات التطبيق
// ══════════════════════════════════════════════════════
ipcMain.handle('app:version',  () => app.getVersion());
ipcMain.handle('app:deviceId', () => dbModule().DEVICE_ID);
ipcMain.handle('app:dbPath',   () => dbModule().DB_PATH);
