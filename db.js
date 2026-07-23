const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'boptogether.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderer_name TEXT NOT NULL,
    store_name TEXT NOT NULL,
    order_date TEXT NOT NULL,
    order_time TEXT NOT NULL,
    bank_name TEXT,
    account_number TEXT,
    account_holder TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    menu TEXT NOT NULL,
    amount INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
  CREATE INDEX IF NOT EXISTS idx_participants_order ON participants(order_id);
`);

module.exports = db;
