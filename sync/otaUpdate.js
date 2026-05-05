/**
 * sync/otaUpdate.js
 * نظام التحديث التلقائي للواجهة (OTA — Over The Air)
 * يجلب renderer/index.html من GitHub بدون إعادة تثبيت .exe
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { app } = require('electron');

// ══════════════════════════════════════════════════════
//  الإعدادات — عدّل GITHUB_RAW_URL لمستودعك
// ══════════════════════════════════════════════════════
const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/hichemdz10/Pos/main/renderer/index.html';

// مسار التحديث في userData (خارج ملفات التثبيت)
const UPDATE_DIR  = path.join(app.getPath('userData'), 'renderer');
const UPDATE_FILE = path.join(UPDATE_DIR, 'index.html');
const TEMP_FILE   = path.join(UPDATE_DIR, 'index.html.tmp');
const META_FILE   = path.join(UPDATE_DIR, 'update-meta.json');

// المسار الأصلي المحزوم مع التثبيت
const BUNDLED_FILE = path.join(__dirname, '..', 'renderer', 'index.html');

// الفحص كل 30 دقيقة أثناء تشغيل التطبيق
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

let _onUpdateReady = null;   // callback للواجهة
let _checkTimer   = null;

// ══════════════════════════════════════════════════════
//  الدوال المساعدة
// ══════════════════════════════════════════════════════

/** حساب SHA-256 لمحتوى نصي */
function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** قراءة ميتاداتا آخر تحديث */
function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return { hash: null, version: null, updatedAt: null };
  }
}

/** حفظ ميتاداتا التحديث */
function writeMeta(hash, version) {
  fs.writeFileSync(META_FILE, JSON.stringify({
    hash,
    version,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════════
//  المسار الصحيح للتحميل (الذكي)
// ══════════════════════════════════════════════════════

/**
 * يُعيد المسار الذي يجب تحميله:
 * - إذا يوجد تحديث في userData → استخدمه
 * - وإلا → استخدم النسخة المحزومة
 */
function getRendererPath() {
  if (fs.existsSync(UPDATE_FILE)) {
    console.log('[OTA] Loading updated renderer from:', UPDATE_FILE);
    return UPDATE_FILE;
  }
  console.log('[OTA] Loading bundled renderer');
  return BUNDLED_FILE;
}

// ══════════════════════════════════════════════════════
//  فحص وتحميل التحديث
// ══════════════════════════════════════════════════════

async function checkRendererUpdate() {
  // لا تفحص في وضع التطوير
  if (!app.isPackaged) return { checked: false, reason: 'dev_mode' };

  console.log('[OTA] Checking for renderer update...');

  try {
    // ── جلب الملف من GitHub ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(GITHUB_RAW_URL, {
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache, no-store',
        'Pragma':        'no-cache',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn('[OTA] Fetch failed:', resp.status);
      return { checked: true, updated: false, reason: `http_${resp.status}` };
    }

    const remoteContent = await resp.text();

    // ── التحقق من أن الملف HTML صالح ──
    if (!remoteContent.includes('<!DOCTYPE html') && !remoteContent.includes('<html')) {
      console.error('[OTA] Invalid HTML received — aborting');
      return { checked: true, updated: false, reason: 'invalid_html' };
    }

    // ── مقارنة الـ Hash ──
    const remoteHash = sha256(remoteContent);
    const meta       = readMeta();

    // تحقق من النسخة المحلية الحالية (محدَّثة أو أصلية)
    const currentFile  = fs.existsSync(UPDATE_FILE) ? UPDATE_FILE : BUNDLED_FILE;
    const localContent = fs.readFileSync(currentFile, 'utf8');
    const localHash    = sha256(localContent);

    if (remoteHash === localHash) {
      console.log('[OTA] Already up to date ✓');
      return { checked: true, updated: false, reason: 'up_to_date' };
    }

    // ── استخراج رقم الإصدار من داخل الـ HTML (اختياري) ──
    const versionMatch = remoteContent.match(/data-app-version="([^"]+)"/);
    const remoteVersion = versionMatch ? versionMatch[1] : new Date().toISOString().slice(0, 10);

    // ── Atomic Write: كتابة مؤقتة ثم إعادة تسمية ──
    // يمنع تلف الملف عند انقطاع الإنترنت أثناء الكتابة
    if (!fs.existsSync(UPDATE_DIR)) {
      fs.mkdirSync(UPDATE_DIR, { recursive: true });
    }

    fs.writeFileSync(TEMP_FILE, remoteContent, 'utf8');
    fs.renameSync(TEMP_FILE, UPDATE_FILE);  // atomic على نفس الـ partition
    writeMeta(remoteHash, remoteVersion);

    console.log(`[OTA] ✅ Update downloaded — version: ${remoteVersion} | hash: ${remoteHash.slice(0, 8)}...`);

    // ── إشعار الواجهة ──
    if (_onUpdateReady) {
      _onUpdateReady({
        version:   remoteVersion,
        hash:      remoteHash.slice(0, 8),
        updatedAt: new Date().toISOString(),
      });
    }

    return { checked: true, updated: true, version: remoteVersion };

  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[OTA] Timeout — check skipped');
      return { checked: true, updated: false, reason: 'timeout' };
    }
    console.error('[OTA] Error:', err.message);
    return { checked: true, updated: false, reason: err.message };
  }
}

// ══════════════════════════════════════════════════════
//  الجدولة التلقائية
// ══════════════════════════════════════════════════════

function startAutoCheck(onUpdateReady) {
  _onUpdateReady = onUpdateReady;

  // فحص فوري عند التشغيل (بعد 10 ثوانٍ حتى يستقر التطبيق)
  setTimeout(() => checkRendererUpdate(), 10_000);

  // فحص دوري
  _checkTimer = setInterval(checkRendererUpdate, CHECK_INTERVAL_MS);
  console.log('[OTA] Auto-check started (every 30 min)');
}

function stopAutoCheck() {
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
}

/** معلومات للواجهة */
function getUpdateInfo() {
  const meta = readMeta();
  return {
    hasUpdate:     fs.existsSync(UPDATE_FILE),
    currentPath:   getRendererPath(),
    lastCheck:     meta.updatedAt,
    version:       meta.version,
    updateDirPath: UPDATE_DIR,
  };
}

/** حذف التحديث والرجوع للنسخة الأصلية */
function rollback() {
  try {
    if (fs.existsSync(UPDATE_FILE)) fs.unlinkSync(UPDATE_FILE);
    if (fs.existsSync(META_FILE))   fs.unlinkSync(META_FILE);
    console.log('[OTA] Rolled back to bundled version');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getRendererPath,
  checkRendererUpdate,
  startAutoCheck,
  stopAutoCheck,
  getUpdateInfo,
  rollback,
};
