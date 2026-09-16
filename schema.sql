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
