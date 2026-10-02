CREATE TABLE IF NOT EXISTS petty_cash_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  item TEXT NOT NULL,
  type TEXT,
  income REAL,
  expense REAL,
  handler TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS petty_cash_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  n1000 INTEGER NOT NULL DEFAULT 0,
  n500  INTEGER NOT NULL DEFAULT 0,
  n100  INTEGER NOT NULL DEFAULT 0,
  n50   INTEGER NOT NULL DEFAULT 0,
  n10   INTEGER NOT NULL DEFAULT 0,
  n5    INTEGER NOT NULL DEFAULT 0,
  n1    INTEGER NOT NULL DEFAULT 0,
  counted REAL NOT NULL DEFAULT 0,
  book    REAL NOT NULL DEFAULT 0,
  diff    REAL NOT NULL DEFAULT 0,
  handler TEXT,
  note TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 餐費與零用金分離(2026-10-02 起):點餐只記在這裡,不再寫入 petty_cash_records
CREATE TABLE IF NOT EXISTS lunch_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  person TEXT NOT NULL,
  item TEXT NOT NULL,
  less_rice INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  handler TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lunch_orders_date   ON lunch_orders(date);
CREATE INDEX IF NOT EXISTS idx_lunch_orders_person ON lunch_orders(person);

-- 每個人繳的餐費
CREATE TABLE IF NOT EXISTS lunch_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  person TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  handler TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lunch_payments_person ON lunch_payments(person);
