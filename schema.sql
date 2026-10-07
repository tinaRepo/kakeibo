CREATE TABLE IF NOT EXISTS ledgers (id TEXT PRIMARY KEY, receipt_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  role TEXT NOT NULL CHECK (role IN ('owner','user')), name TEXT, code_hash TEXT NOT NULL UNIQUE,
  can_tx INTEGER NOT NULL DEFAULT 1, can_category INTEGER NOT NULL DEFAULT 0, can_sub INTEGER NOT NULL DEFAULT 0, can_budget INTEGER NOT NULL DEFAULT 0,
  notify_budget INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_members_ledger ON members(ledger_id);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), token_hash TEXT NOT NULL UNIQUE, device_label TEXT, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS device_links (code_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), purpose TEXT NOT NULL CHECK (purpose IN ('device','handoff')), expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id TEXT NOT NULL REFERENCES ledgers(id), type TEXT NOT NULL CHECK (type IN ('expense','income')), name TEXT NOT NULL, icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledgers(id), type TEXT NOT NULL CHECK (type IN ('expense','income')),
  date TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), amount INTEGER NOT NULL, memo TEXT,
  created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tx_ledger_date ON transactions(ledger_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_ledger_updated ON transactions(ledger_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tx_created_by ON transactions(created_by, updated_at);
CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id TEXT NOT NULL REFERENCES ledgers(id), name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), amount INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT, memo TEXT);
CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id TEXT NOT NULL REFERENCES ledgers(id), category_id INTEGER REFERENCES categories(id), month TEXT, amount INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_unique ON budgets(ledger_id, COALESCE(category_id, 0), COALESCE(month, ''));
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledgers(id), transaction_id TEXT NOT NULL REFERENCES transactions(id), r2_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_receipts_tx ON receipts(transaction_id);
CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL REFERENCES members(id), kind TEXT NOT NULL CHECK (kind IN ('question','request','bug','recovery')), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','replied','closed')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inquiry_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, inquiry_id INTEGER NOT NULL REFERENCES inquiries(id), sender TEXT NOT NULL CHECK (sender IN ('member','admin')), body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
CREATE INDEX IF NOT EXISTS idx_inq_member ON inquiries(member_id);
CREATE INDEX IF NOT EXISTS idx_msg_inq ON inquiry_messages(inquiry_id);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL);
