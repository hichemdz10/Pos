-- ══════════════════════════════════════════
--  schema.sql — قاعدة بيانات SQLite المحلية
--  كل جدول Supabase + حقول المزامنة
-- ══════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── المنتجات ──────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  category      TEXT,
  price         REAL    DEFAULT 0,
  cost          REAL    DEFAULT 0,
  stock         REAL    DEFAULT 0,
  barcode       TEXT,
  unit          TEXT    DEFAULT 'قطعة',
  min_stock     REAL    DEFAULT 0,
  icon          TEXT,
  icon_color    TEXT,
  img_url       TEXT,
  notes         TEXT,
  -- ── حقول المزامنة ──
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  device_id     TEXT    NOT NULL DEFAULT '',
  sync_status   TEXT    NOT NULL DEFAULT 'pending',
  deleted_at    TEXT,
  server_hash   TEXT,
  -- ── حقل خاص: بيع بالزيادة ──
  oversold_qty  REAL    DEFAULT 0
);

-- ── التصنيفات ─────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  device_id   TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  deleted_at  TEXT,
  server_hash TEXT
);

-- ── العملاء ───────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  balance     REAL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  device_id   TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  deleted_at  TEXT,
  server_hash TEXT
);

-- ── الموردون ──────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  balance     REAL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  device_id   TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  deleted_at  TEXT,
  server_hash TEXT
);

-- ── المبيعات ──────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  customer_name TEXT,
  items         TEXT NOT NULL,   -- JSON
  total         REAL DEFAULT 0,
  discount      REAL DEFAULT 0,
  paid          REAL DEFAULT 0,
  change        REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  note          TEXT,
  invoice_no    TEXT,
  sale_date     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  device_id     TEXT NOT NULL DEFAULT '',
  sync_status   TEXT NOT NULL DEFAULT 'pending',
  deleted_at    TEXT,
  server_hash   TEXT
);

-- ── المشتريات ─────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id           TEXT PRIMARY KEY,
  supplier_id  TEXT,
  supplier_name TEXT,
  items        TEXT NOT NULL,   -- JSON
  total        REAL DEFAULT 0,
  paid         REAL DEFAULT 0,
  note         TEXT,
  purchase_date TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  device_id    TEXT NOT NULL DEFAULT '',
  sync_status  TEXT NOT NULL DEFAULT 'pending',
  deleted_at   TEXT,
  server_hash  TEXT
);

-- ── الباقات ───────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  items       TEXT NOT NULL,   -- JSON
  price       REAL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  device_id   TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'pending',
  deleted_at  TEXT,
  server_hash TEXT
);

-- ── الإعدادات ─────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  device_id   TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

-- ══════════════════════════════════════════
--  جداول البنية التحتية للمزامنة
-- ══════════════════════════════════════════

-- ── طابور المزامنة ────────────────────────
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT    NOT NULL,
  record_id   TEXT    NOT NULL,
  operation   TEXT    NOT NULL,   -- INSERT | UPDATE | DELETE
  payload     TEXT    NOT NULL,   -- JSON
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  attempts    INTEGER DEFAULT 0,
  next_retry  TEXT,               -- datetime للمحاولة القادمة
  error_msg   TEXT
);

-- ── سجل التعارضات ─────────────────────────
CREATE TABLE IF NOT EXISTS conflict_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name   TEXT,
  record_id    TEXT,
  local_data   TEXT,              -- JSON
  remote_data  TEXT,              -- JSON
  resolved_by  TEXT,              -- 'local' | 'remote' | 'manual'
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── سجل البيع بالزيادة ────────────────────
CREATE TABLE IF NOT EXISTS oversold_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   TEXT NOT NULL,
  product_name TEXT,
  sold_qty     REAL NOT NULL,
  available_qty REAL NOT NULL,    -- الرصيد وقت البيع
  oversold_qty REAL NOT NULL,     -- الكمية الزائدة
  sale_id      TEXT,
  device_id    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  notified     INTEGER DEFAULT 0  -- 0=لم يُبلَّغ | 1=بُلِّغ
);

-- ── نقطة استئناف Bootstrap ────────────────
CREATE TABLE IF NOT EXISTS sync_cursors (
  table_name   TEXT PRIMARY KEY,
  last_sync_at TEXT,              -- آخر updated_at تمت مزامنته
  total_pulled INTEGER DEFAULT 0
);

-- ── Indexes للأداء ────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_sync   ON products(sync_status);
CREATE INDEX IF NOT EXISTS idx_sales_sync      ON sales(sync_status);
CREATE INDEX IF NOT EXISTS idx_queue_retry     ON sync_queue(next_retry);
CREATE INDEX IF NOT EXISTS idx_queue_table     ON sync_queue(table_name, record_id);
