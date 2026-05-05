/**
 * database/db.js
 * طبقة الوصول لـ SQLite — تعمل في العملية الرئيسية (main process)
 */

const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

// ── مسار قاعدة البيانات ──────────────────────────────
const DB_PATH  = path.join(app.getPath('userData'), 'pos-database.db');
const SCH_PATH = path.join(__dirname, 'schema.sql');

let _db = null;  // Singleton

// ── معرّف الجهاز (ثابت لكل تثبيت) ──────────────────
const Store = require('electron-store');
const store = new Store();
let DEVICE_ID = store.get('deviceId');
if (!DEVICE_ID) {
  DEVICE_ID = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  store.set('deviceId', DEVICE_ID);
}

// ── تهيئة قاعدة البيانات ────────────────────────────
function init() {
  if (_db) return _db;

  const Database = require('better-sqlite3');
  _db = new Database(DB_PATH, { verbose: null });

  // تطبيق الـ Schema
  const schema = fs.readFileSync(SCH_PATH, 'utf8');
  _db.exec(schema);

  // WAL Mode للأداء
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');

  console.log('[DB] Initialized at:', DB_PATH, '| Device:', DEVICE_ID);
  return _db;
}

function getDB() {
  return _db || init();
}

// ── تحويل camelCase ↔ snake_case ─────────────────────
function toSnake(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const r = {};
  for (const [k, v] of Object.entries(obj))
    r[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = v;
  return r;
}

function toCamel(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const r = {};
  for (const [k, v] of Object.entries(obj))
    r[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return r;
}

// ── توليد UUID آمن ───────────────────────────────────
const { randomUUID } = require('crypto');
function uuid() {
  return randomUUID();
}

// ── إضافة للطابور ────────────────────────────────────
function enqueue(tableName, recordId, operation, payload) {
  const db = getDB();
  db.prepare(`
    INSERT INTO sync_queue (table_name, record_id, operation, payload, created_at, next_retry)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(tableName, recordId, operation, JSON.stringify(payload));
}

// ══════════════════════════════════════════════════════
//  CRUD الرئيسي
// ══════════════════════════════════════════════════════

/**
 * جلب كل سجلات جدول (بدون المحذوفات)
 */
function getAll(tableName) {
  const db = getDB();
  const rows = db.prepare(
    `SELECT * FROM ${tableName} WHERE deleted_at IS NULL ORDER BY created_at ASC`
  ).all();
  return rows.map(toCamel);
}

/**
 * حفظ (إدراج أو تحديث) سجل
 * يُعيد الـ id
 */
function save(tableName, item) {
  const db    = getDB();
  const now   = new Date().toISOString();
  const isNew = !item.id;
  const id    = item.id || uuid();

  const row = toSnake({ ...item, id });
  row.updated_at  = now;
  row.device_id   = DEVICE_ID;
  row.sync_status = 'pending';

  if (isNew) {
    row.created_at = now;
    // بناء INSERT ديناميكي
    const cols = Object.keys(row).join(', ');
    const vals = Object.keys(row).map(() => '?').join(', ');
    db.prepare(`INSERT OR REPLACE INTO ${tableName} (${cols}) VALUES (${vals})`)
      .run(...Object.values(row));
  } else {
    // UPDATE
    const sets = Object.keys(row)
      .filter(k => k !== 'id')
      .map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE ${tableName} SET ${sets} WHERE id = ?`)
      .run(...Object.keys(row).filter(k => k !== 'id').map(k => row[k]), id);
  }

  // أضف للطابور
  enqueue(tableName, id, isNew ? 'INSERT' : 'UPDATE', toSnake({ ...item, id }));

  return id;
}

/**
 * حذف ناعم (Soft Delete)
 */
function remove(tableName, id) {
  const db  = getDB();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ${tableName} SET deleted_at = ?, sync_status = 'pending', device_id = ? WHERE id = ?`
  ).run(now, DEVICE_ID, id);

  enqueue(tableName, id, 'DELETE', { id });
}

// ══════════════════════════════════════════════════════
//  معالجة المخزون السالب (Negative Stock)
// ══════════════════════════════════════════════════════

/**
 * تحديث المخزون مع حماية من الرصيد السالب
 * يُعيد { newStock, oversold }
 */
function updateStock(productId, delta) {
  const db = getDB();

  // قراءة وتحديث في transaction واحدة
  const result = db.transaction(() => {
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!prod) throw new Error('المنتج غير موجود: ' + productId);

    const rawNew   = prod.stock + delta;  // delta سالب عند البيع
    const newStock = Math.max(0, rawNew);
    const oversold = rawNew < 0 ? Math.abs(rawNew) : 0;

    db.prepare(`
      UPDATE products
      SET stock = ?, oversold_qty = oversold_qty + ?, updated_at = datetime('now'),
          sync_status = 'pending', device_id = ?
      WHERE id = ?
    `).run(newStock, oversold, DEVICE_ID, productId);

    if (oversold > 0) {
      // سجّل في جدول البيع بالزيادة
      db.prepare(`
        INSERT INTO oversold_log (product_id, product_name, sold_qty, available_qty, oversold_qty, device_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(productId, prod.name, Math.abs(delta), prod.stock, oversold, DEVICE_ID);
    }

    enqueue('products', productId, 'UPDATE', { id: productId, stock: newStock });

    return { newStock, oversold, productName: prod.name };
  })();

  return result;
}

/**
 * جلب تنبيهات البيع بالزيادة غير المقروءة
 */
function getOversoldAlerts() {
  const db = getDB();
  return db.prepare(`
    SELECT * FROM oversold_log WHERE notified = 0 ORDER BY created_at DESC
  `).all();
}

function markOversoldNotified(ids) {
  const db = getDB();
  const ph = ids.map(() => '?').join(',');
  db.prepare(`UPDATE oversold_log SET notified = 1 WHERE id IN (${ph})`).run(...ids);
}

// ══════════════════════════════════════════════════════
//  طابور المزامنة — قراءة وتحديث
// ══════════════════════════════════════════════════════

function getPendingQueue(limit = 50) {
  const db = getDB();
  return db.prepare(`
    SELECT * FROM sync_queue
    WHERE (next_retry IS NULL OR next_retry <= datetime('now'))
    ORDER BY id ASC
    LIMIT ?
  `).all(limit);
}

function markQueueSuccess(id) {
  const db = getDB();
  db.prepare('DELETE FROM sync_queue WHERE id = ?').run(id);
}

function markQueueFailed(id, errorMsg, attempts) {
  // Exponential Backoff: 1s, 5s, 60s, 300s, 900s
  const delays = [1, 5, 60, 300, 900];
  const delay  = delays[Math.min(attempts, delays.length - 1)];
  const next   = new Date(Date.now() + delay * 1000).toISOString();

  getDB().prepare(`
    UPDATE sync_queue
    SET attempts = ?, next_retry = ?, error_msg = ?
    WHERE id = ?
  `).run(attempts + 1, next, errorMsg, id);
}

// ── Sync Cursors (Bootstrap Pagination) ──────────────
function getSyncCursor(tableName) {
  const row = getDB().prepare(
    'SELECT * FROM sync_cursors WHERE table_name = ?'
  ).get(tableName);
  return row ? row.last_sync_at : null;
}

function setSyncCursor(tableName, lastSyncAt, totalPulled) {
  getDB().prepare(`
    INSERT OR REPLACE INTO sync_cursors (table_name, last_sync_at, total_pulled)
    VALUES (?, ?, ?)
  `).run(tableName, lastSyncAt, totalPulled);
}

// ── Conflict Log ──────────────────────────────────────
function logConflict(tableName, recordId, localData, remoteData, resolvedBy) {
  getDB().prepare(`
    INSERT INTO conflict_log (table_name, record_id, local_data, remote_data, resolved_by, resolved_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(tableName, recordId, JSON.stringify(localData), JSON.stringify(remoteData), resolvedBy);
}

// ── تطبيق سجل سحابي محلياً (عند الـ Pull) ───────────
function applyRemoteRecord(tableName, remoteRow) {
  const db  = getDB();
  const now = new Date().toISOString();

  // هل السجل موجود محلياً؟
  const local = db.prepare(
    `SELECT * FROM ${tableName} WHERE id = ?`
  ).get(remoteRow.id);

  if (!local) {
    // جديد من السحابة — إدراج مباشر
    const row = { ...remoteRow, sync_status: 'synced', device_id: remoteRow.device_id || '' };
    const cols = Object.keys(row).join(', ');
    const vals = Object.keys(row).map(() => '?').join(', ');
    db.prepare(`INSERT OR IGNORE INTO ${tableName} (${cols}) VALUES (${vals})`)
      .run(...Object.values(row));
    return 'inserted';
  }

  // موجود — قارن updated_at
  const localTime  = new Date(local.updated_at  || 0).getTime();
  const remoteTime = new Date(remoteRow.updated_at || 0).getTime();

  if (local.sync_status === 'pending' && localTime > remoteTime) {
    // تعديل محلي أحدث — تعارض: احتفظ بالمحلي وسجّله
    logConflict(tableName, remoteRow.id, local, remoteRow, 'local');
    // ⚠️ أضف للجدول المخصص للإشعار بالتعارض
    db.prepare(`
      INSERT OR IGNORE INTO conflict_log
        (table_name, record_id, local_data, remote_data, resolved_by, resolved_at)
      VALUES (?, ?, ?, ?, 'local', datetime('now'))
    `).run(tableName, remoteRow.id, JSON.stringify(local), JSON.stringify(remoteRow));
    return 'conflict_kept_local';
  }

  // السحابة أحدث — طبّق
  const sets = Object.keys(remoteRow)
    .filter(k => k !== 'id')
    .map(k => `${k} = ?`).join(', ');
  db.prepare(
    `UPDATE ${tableName} SET ${sets}, sync_status = 'synced' WHERE id = ?`
  ).run(
    ...Object.keys(remoteRow).filter(k => k !== 'id').map(k => remoteRow[k]),
    remoteRow.id
  );
  return 'updated';
}

// ── تطبيق دُفعة سجلات في transaction واحدة (Bootstrap) ──
function applyRemoteBatch(tableName, rows) {
  const db = getDB();
  const applyAll = db.transaction((batch) => {
    const results = { inserted: 0, updated: 0, conflict: 0 };
    for (const row of batch) {
      const r = applyRemoteRecord(tableName, row);
      if (r === 'inserted')             results.inserted++;
      else if (r === 'updated')         results.updated++;
      else if (r === 'conflict_kept_local') results.conflict++;
    }
    return results;
  });
  return applyAll(rows);
}

// ── إحصاءات للواجهة ──────────────────────────────────
function getSyncStats() {
  const db = getDB();
  return {
    pending:   db.prepare("SELECT COUNT(*) as c FROM sync_queue").get().c,
    conflicts: db.prepare("SELECT COUNT(*) as c FROM conflict_log WHERE resolved_at IS NULL").get().c,
    oversold:  db.prepare("SELECT COUNT(*) as c FROM oversold_log WHERE notified = 0").get().c,
    deviceId:  DEVICE_ID,
    dbPath:    DB_PATH,
  };
}

module.exports = {
  init,
  getDB,
  getAll,
  save,
  remove,
  updateStock,
  getOversoldAlerts,
  markOversoldNotified,
  getPendingQueue,
  markQueueSuccess,
  markQueueFailed,
  getSyncCursor,
  setSyncCursor,
  applyRemoteRecord,
  applyRemoteBatch,
  logConflict,
  getSyncStats,
  DEVICE_ID,
  DB_PATH,
};
