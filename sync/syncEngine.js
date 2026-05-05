/**
 * sync/syncEngine.js
 * محرك المزامنة — Offline-First + Delta Sync + Exponential Backoff
 */

const { createClient } = require('@supabase/supabase-js');
const db = require('../database/db');

const SUPA_URL = "https://wvyqsdjbvtfwzsgipnpy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eXFzZGpidnRmd3pzZ2lwbnB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjg4ODUsImV4cCI6MjA5MjcwNDg4NX0.h8IkW7trVcTYSq8HRPyTAMs-TGR4M7lhD8f5CNm8e9I";

const TABLES = ['categories', 'products', 'customers', 'suppliers', 'sales', 'purchases', 'packages'];
const BOOTSTRAP_PAGE = 500;    // عدد السجلات لكل دفعة

let supa    = null;
let online  = false;
let syncing = false;
let pushTimer = null;

// callbacks للواجهة
let _onStatusChange = null;
let _onBootstrapProgress = null;

// ──────────────────────────────────────────────────────
//  تهيئة
// ──────────────────────────────────────────────────────
function init(onStatusChange, onBootstrapProgress) {
  _onStatusChange       = onStatusChange       || (() => {});
  _onBootstrapProgress  = onBootstrapProgress  || (() => {});

  supa = createClient(SUPA_URL, SUPA_KEY);
  db.init();

  _startNetworkMonitor();
  _schedulePush();

  console.log('[Sync] Engine started | Device:', db.DEVICE_ID);
}

// ──────────────────────────────────────────────────────
//  مراقبة الشبكة
// ──────────────────────────────────────────────────────
function _startNetworkMonitor() {
  _checkOnline();
  setInterval(_checkOnline, 60_000);  // كل 60 ثانية (لا ضغط على المعالج)
}

async function _checkOnline() {
  // مرحلة 1: Ping خفيف جداً (HEAD request) — لا يحمّل البيانات
  // أسرع وأخف من استعلام Supabase الكامل
  const isReachable = await _pingSupabase();
  const wasOnline = online;
  online = isReachable;

  if (!wasOnline && online) {
    console.log('[Sync] ✅ Back online — flushing queue');
    _emit();
    _flushQueue();
  }
  if (wasOnline && !online) {
    console.log('[Sync] ❌ Went offline');
    _emit();
  }
}

// Ping حقيقي يتحقق من الاتصال بالإنترنت فعلاً
// (navigator.onLine غير موثوق — يكشف الكابل لا الإنترنت)
async function _pingSupabase() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000); // 5 ثوانٍ حد أقصى

    const res = await fetch(SUPA_URL + '/rest/v1/', {
      method: 'HEAD',
      headers: { 'apikey': SUPA_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status === 401; // 401 يعني السيرفر يرد (مصادقة فقط)
  } catch {
    return false; // timeout أو لا إنترنت
  }
}

// ──────────────────────────────────────────────────────
//  Push — إرسال الطابور لـ Supabase
// ──────────────────────────────────────────────────────
function _schedulePush() {
  // تشغيل كل 30 ثانية
  pushTimer = setInterval(() => {
    if (online && !syncing) _flushQueue();
  }, 30_000);
}

async function _flushQueue() {
  if (!online || syncing) return;
  syncing = true;
  _emit();

  const items = db.getPendingQueue(50);
  if (items.length === 0) { syncing = false; _emit(); return; }

  console.log(`[Sync] Pushing ${items.length} items...`);

  for (const item of items) {
    try {
      const payload = JSON.parse(item.payload);

      if (item.operation === 'DELETE') {
        const { error } = await supa
          .from(item.table_name)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', item.record_id);
        if (error) throw error;
      } else {
        // INSERT or UPDATE — upsert
        const { error } = await supa
          .from(item.table_name)
          .upsert(payload, { onConflict: 'id' });
        if (error) throw error;

        // حدّث sync_status محلياً
        db.getDB().prepare(
          `UPDATE ${item.table_name} SET sync_status = 'synced' WHERE id = ?`
        ).run(item.record_id);
      }

      db.markQueueSuccess(item.id);
    } catch (err) {
      console.error(`[Sync] Push failed: ${item.table_name}#${item.record_id}`, err.message);
      db.markQueueFailed(item.id, err.message, item.attempts);
    }
  }

  syncing = false;
  _emit();
}

// ──────────────────────────────────────────────────────
//  Pull — جلب التغييرات من Supabase (Delta Sync)
// ──────────────────────────────────────────────────────
async function pull() {
  if (!online) return { success: false, reason: 'offline' };

  for (const table of TABLES) {
    try {
      const cursor = db.getSyncCursor(table);  // آخر updated_at تمت مزامنته

      let query = supa.from(table).select('*').order('updated_at', { ascending: true });
      if (cursor) query = query.gt('updated_at', cursor);
      query = query.limit(BOOTSTRAP_PAGE);

      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) continue;

      // ── إصلاح ③: transaction واحدة للدُفعة كاملة ──
      const batchResult = db.applyRemoteBatch(table, data);

      // إشعار بالتعارضات
      if (batchResult.conflict > 0) {
        _onStatusChange({ ...getStatus(), conflictAlert: `${table}: ${batchResult.conflict} تعارض` });
      }

      // حدّث cursor
      const lastUpdated = data[data.length - 1].updated_at;
      db.setSyncCursor(table, lastUpdated, data.length);

      console.log(`[Sync] Pulled ${data.length} from ${table}`);
    } catch (err) {
      console.error(`[Sync] Pull error on ${table}:`, err.message);
    }
  }

  _emit();
  return { success: true };
}

// ──────────────────────────────────────────────────────
//  Bootstrap الأولي — مع شريط تقدم
// ──────────────────────────────────────────────────────
async function bootstrap() {
  if (!online) return { success: false, reason: 'offline' };

  const tableCount = TABLES.length;
  let tablesDone   = 0;

  _onBootstrapProgress({ percent: 0, message: 'جاري تحميل قاعدة البيانات...' });

  for (const table of TABLES) {
    let offset = 0;
    let totalFetched = 0;

    while (true) {
      try {
        const { data, error, count } = await supa
          .from(table)
          .select('*', { count: 'estimated' })
          .order('updated_at', { ascending: true })
          .range(offset, offset + BOOTSTRAP_PAGE - 1);

        if (error) throw error;
        if (!data?.length) break;

        // ── إصلاح ③: تطبيق الدُفعة في transaction واحدة (أسرع بكثير) ──
        const batchResult = db.applyRemoteBatch(table, data);
        totalFetched += data.length;

        // إشعار بالتعارضات إن وُجدت
        if (batchResult.conflict > 0) {
          _onStatusChange({ ...getStatus(), conflictAlert: `${table}: ${batchResult.conflict} تعارض` });
        }
        offset       += BOOTSTRAP_PAGE;

        // حدّث cursor بآخر سجل
        const lastUpdated = data[data.length - 1].updated_at;
        db.setSyncCursor(table, lastUpdated, totalFetched);

        // حسب نسبة التقدم
        const tableProgress = (tablesDone / tableCount) + (1 / tableCount) * Math.min(1, data.length / BOOTSTRAP_PAGE);
        const percent = Math.round(tableProgress * 100);
        _onBootstrapProgress({
          percent,
          message: `جلب ${table}: ${totalFetched} سجل...`,
          table
        });

        if (data.length < BOOTSTRAP_PAGE) break;  // آخر صفحة
      } catch (err) {
        console.error(`[Bootstrap] Error on ${table}:`, err.message);
        // إذا انقطع الإنترنت — استأنف لاحقاً من cursor المحفوظ
        break;
      }
    }

    tablesDone++;
    const percent = Math.round((tablesDone / tableCount) * 100);
    _onBootstrapProgress({ percent, message: `اكتمل: ${table}`, table });
  }

  _onBootstrapProgress({ percent: 100, message: 'اكتملت المزامنة الأولية ✅' });
  return { success: true };
}

// ──────────────────────────────────────────────────────
//  Force Push / Force Pull
// ──────────────────────────────────────────────────────
async function forcePush() {
  return _flushQueue();
}

async function forcePull() {
  return pull();
}

// ──────────────────────────────────────────────────────
//  الحالة الحالية للواجهة
// ──────────────────────────────────────────────────────
function getStatus() {
  const stats = db.getSyncStats();
  return {
    online,
    syncing,
    pendingCount:   stats.pending,
    conflictCount:  stats.conflicts,
    oversoldCount:  stats.oversold,
    deviceId:       stats.deviceId,
    lastSync:       new Date().toISOString(),
  };
}

function _emit() {
  try {
    const status = getStatus();
    _onStatusChange(status);
    // إشعار منفصل بالتعارضات غير المحلولة
    if (status.conflictCount > 0) {
      const conflicts = db.getDB().prepare(
        `SELECT table_name, record_id, resolved_by, created_at
         FROM conflict_log WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 10`
      ).all();
      if (conflicts.length) _onStatusChange({ ...status, pendingConflicts: conflicts });
    }
  } catch (_) {}
}

module.exports = { init, pull, bootstrap, forcePush, forcePull, getStatus };
