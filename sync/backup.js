/**
 * sync/backup.js
 * نسخ احتياطي تلقائي — يومي + أسبوعي مع دوران النسخ
 */

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');
const dbModule = require('../database/db');

// ── مجلدات النسخ الاحتياطية ──────────────────────────
const BACKUP_BASE    = path.join(app.getPath('userData'), 'Backups');
const BACKUP_DAILY   = path.join(BACKUP_BASE, 'daily');
const BACKUP_WEEKLY  = path.join(BACKUP_BASE, 'weekly');
const KEEP_DAILY     = 7;   // آخر 7 نسخ يومية
const KEEP_WEEKLY    = 4;   // آخر 4 نسخ أسبوعية

function ensureDirs() {
  [BACKUP_BASE, BACKUP_DAILY, BACKUP_WEEKLY].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── تنسيق التاريخ للاسم ───────────────────────────────
function dateTag() {
  return new Date().toISOString().slice(0, 10);  // 2025-01-15
}
function datetimeTag() {
  return new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
}

// ── نسخة واحدة ───────────────────────────────────────
function doBackup(destDir) {
  ensureDirs();
  const src  = dbModule.DB_PATH;
  const name = `pos-backup-${datetimeTag()}.db`;
  const dest = path.join(destDir, name);

  // Electron يتيح نسخ SQLite مباشرة (WAL mode آمن)
  fs.copyFileSync(src, dest);
  console.log('[Backup] Created:', dest);
  return dest;
}

// ── حذف النسخ القديمة (دوران) ────────────────────────
function rotate(dir, keep) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);  // الأحدث أولاً

  const toDelete = files.slice(keep);
  toDelete.forEach(f => {
    fs.unlinkSync(path.join(dir, f.name));
    console.log('[Backup] Deleted old backup:', f.name);
  });
}

// ── النسخة اليومية ───────────────────────────────────
function dailyBackup() {
  try {
    doBackup(BACKUP_DAILY);
    rotate(BACKUP_DAILY, KEEP_DAILY);

    // هل اليوم الأحد؟ → نسخة أسبوعية أيضاً
    if (new Date().getDay() === 0) {
      doBackup(BACKUP_WEEKLY);
      rotate(BACKUP_WEEKLY, KEEP_WEEKLY);
    }
    return { success: true };
  } catch (err) {
    console.error('[Backup] Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── نسخ إلى USB (إذا موصول) ─────────────────────────
function backupToUSB() {
  try {
    // Windows: أحرف D: إلى Z:
    const drives = [];
    for (let c = 68; c <= 90; c++) {
      const d = String.fromCharCode(c) + ':\\';
      if (fs.existsSync(d)) drives.push(d);
    }

    if (!drives.length) return { success: false, reason: 'no_usb' };

    const results = [];
    for (const drive of drives) {
      try {
        const dest = path.join(drive, 'POS_Backup');
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        doBackup(dest);
        rotate(dest, 5);
        results.push({ drive, success: true });
      } catch (e) {
        results.push({ drive, success: false, error: e.message });
      }
    }
    return { success: true, drives: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── جدولة تلقائية ────────────────────────────────────
let _timer = null;

function schedule() {
  // نسخ عند الإغلاق
  app.on('before-quit', () => {
    console.log('[Backup] App closing — creating backup...');
    dailyBackup();
    backupToUSB();
  });

  // نسخ كل 24 ساعة إذا التطبيق مفتوح طوال اليوم
  _timer = setInterval(() => {
    dailyBackup();
  }, 24 * 60 * 60 * 1000);

  // نسخة عند التشغيل (مرة في اليوم فقط)
  const today = dateTag();
  const lastBackupKey = 'lastBackupDate';
  const Store = require('electron-store');
  const store = new Store();
  if (store.get(lastBackupKey) !== today) {
    dailyBackup();
    store.set(lastBackupKey, today);
  }
}

function listBackups() {
  ensureDirs();
  const read = dir => fs.readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, size: stat.size, date: stat.mtime };
    })
    .sort((a, b) => b.date - a.date);

  return {
    daily:  read(BACKUP_DAILY),
    weekly: read(BACKUP_WEEKLY),
  };
}

module.exports = { schedule, dailyBackup, backupToUSB, listBackups };
