const { app, BrowserWindow } = require('electron');

function createWindow () {
  // إعدادات نافذة البرنامج
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // إخفاء شريط القوائم العلوي ليبدو كبرنامج احترافي
  win.setMenuBarVisibility(false);

  // تحميل ملفك الأساسي
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
