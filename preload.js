const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── فتح النوافذ عند الطلب (من زر في الكاشير) ──
  openAdminWindow:    () => ipcRenderer.send('window:openAdmin'),
  openCustomerWindow: () => ipcRenderer.send('window:openCustomer'),

  // ── إرسال بيانات السلة لشاشة الزبون ──
  sendDisplayUpdate: (data) => ipcRenderer.send('display:update', data),
  sendDisplayConfig: (data) => ipcRenderer.send('display:config', data),

  // ── استقبال في display.html و display-admin.html ──
  onDisplayUpdate: (cb) =>
    ipcRenderer.on('display:update', (_e, data) => cb(data)),
  onDisplayConfig: (cb) =>
    ipcRenderer.on('display:config', (_e, data) => cb(data)),

  removeDisplayListeners: () => {
    ipcRenderer.removeAllListeners('display:update');
    ipcRenderer.removeAllListeners('display:config');
  }

});
