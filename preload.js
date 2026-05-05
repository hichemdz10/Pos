/**
 * preload.js
 * الجسر الآمن بين الواجهة (React) والعملية الرئيسية (Node.js)
 * يعمل في بيئة معزولة (contextIsolation: true)
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ══════════════════════════════════════════
  //  قاعدة البيانات — CRUD
  // ══════════════════════════════════════════
  db: {
    getAll:  (table)       => ipcRenderer.invoke('db:getAll',  table),
    save:    (table, item) => ipcRenderer.invoke('db:save',    table, item),
    remove:  (table, id)   => ipcRenderer.invoke('db:remove',  table, id),
    updateStock: (productId, delta)
                           => ipcRenderer.invoke('db:updateStock', productId, delta),
    getOversoldAlerts:     () => ipcRenderer.invoke('db:getOversoldAlerts'),
    markOversoldNotified: (ids) => ipcRenderer.invoke('db:markOversoldNotified', ids),
    getStats:              () => ipcRenderer.invoke('db:getStats'),
  },

  // ══════════════════════════════════════════
  //  المزامنة
  // ══════════════════════════════════════════
  sync: {
    getStatus:  () => ipcRenderer.invoke('sync:getStatus'),
    forcePush:  () => ipcRenderer.invoke('sync:forcePush'),
    forcePull:  () => ipcRenderer.invoke('sync:forcePull'),
    bootstrap:  () => ipcRenderer.invoke('sync:bootstrap'),

    // استقبال تحديثات الحالة من الخلفية
    onStatusChange:       (cb) => ipcRenderer.on('sync:status',   (_, s) => cb(s)),
    onBootstrapProgress:  (cb) => ipcRenderer.on('sync:bootstrap-progress', (_, p) => cb(p)),
    onOversoldAlert:      (cb) => ipcRenderer.on('sync:oversold',  (_, a) => cb(a)),
    onConflictAlert:      (cb) => ipcRenderer.on('sync:conflict',  (_, c) => cb(c)),

    // إزالة المستمعين
    removeStatusListener: () => ipcRenderer.removeAllListeners('sync:status'),
  },

  // ══════════════════════════════════════════
  //  النسخ الاحتياطي
  // ══════════════════════════════════════════
  backup: {
    doNow:      () => ipcRenderer.invoke('backup:doNow'),
    toUSB:      () => ipcRenderer.invoke('backup:toUSB'),
    list:       () => ipcRenderer.invoke('backup:list'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
  },

  // ══════════════════════════════════════════
  //  OTA — تحديث الواجهة التلقائي
  // ══════════════════════════════════════════
  ota: {
    check:         () => ipcRenderer.invoke('ota:check'),
    info:          () => ipcRenderer.invoke('ota:info'),
    rollback:      () => ipcRenderer.invoke('ota:rollback'),
    restart:       () => ipcRenderer.invoke('ota:restart'),
    onUpdateReady: (cb) => ipcRenderer.on('app:update-ready', (_, info) => cb(info)),
  },

  // ══════════════════════════════════════════
  //  معلومات النظام
  // ══════════════════════════════════════════
  app: {
    version:  () => ipcRenderer.invoke('app:version'),
    deviceId: () => ipcRenderer.invoke('app:deviceId'),
    dbPath:   () => ipcRenderer.invoke('app:dbPath'),
  },
});
