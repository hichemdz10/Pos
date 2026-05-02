const { app, BrowserWindow, screen } = require('electron');

// ── السطر المضاف لتعطيل قيود تشغيل الصوت تلقائياً ──
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow, adminWindow, customerWindow;

function createWindows() {
  let displays = screen.getAllDisplays();
  
  // البحث عن الشاشة الخارجية
  let externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  // 1. نافذة الكاشير الرئيسية (على شاشة الكمبيوتر)
  mainWindow = new BrowserWindow({
    width: 1000, height: 700,
    title: "الكاشير - مكتبة حشايشي",
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  // 2. لوحة تحكم شاشة الزبون (نافذة مستقلة على شاشة الكمبيوتر)
  adminWindow = new BrowserWindow({
    width: 600, height: 400,
    title: "لوحة تحكم الشاشة الخارجية",
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  adminWindow.loadFile('display-admin.html');
  adminWindow.setMenuBarVisibility(false);

  // 3. شاشة الزبون (تفتح في الشاشة الخارجية)
  if (externalDisplay) {
    customerWindow = new BrowserWindow({
      x: externalDisplay.bounds.x,
      y: externalDisplay.bounds.y,
      width: externalDisplay.bounds.width,
      height: externalDisplay.bounds.height,
      fullscreen: true,
      title: "شاشة الزبون",
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
  } else {
    // إذا لم تتوفر شاشة خارجية، تفتح كنافذة تجريبية
    customerWindow = new BrowserWindow({
      width: 800, height: 600,
      title: "شاشة الزبون (تجريبية)",
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
  }
  customerWindow.loadFile('display.html');
  customerWindow.setMenuBarVisibility(false);

  // إغلاق كل النوافذ عند إغلاق النافذة الرئيسية
  mainWindow.on('closed', () => app.quit());
}

app.whenReady().then(createWindows);

// معالجة إغلاق التطبيق في أنظمة macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
