const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'worktrack.db');

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  createTables();
  await seedData();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('worker','manager')),
      wage INTEGER DEFAULT 0,
      phone TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      type TEXT NOT NULL,
      manager_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent')),
      time TEXT NOT NULL,
      project_id TEXT,
      confirmed INTEGER DEFAULT 0,
      confirmed_by TEXT,
      confirmed_at TEXT,
      UNIQUE(worker_id, date),
      FOREIGN KEY(worker_id) REFERENCES users(id),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      applied_date TEXT NOT NULL,
      actioned_by TEXT,
      actioned_at TEXT,
      FOREIGN KEY(worker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS advances (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      advance_type TEXT NOT NULL,
      destination TEXT DEFAULT '',
      reason TEXT NOT NULL,
      needed_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      applied_date TEXT NOT NULL,
      actioned_by TEXT,
      actioned_at TEXT,
      FOREIGN KEY(worker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS worker_projects (
      worker_id TEXT PRIMARY KEY,
      project_id TEXT,
      assigned_at TEXT,
      FOREIGN KEY(worker_id) REFERENCES users(id),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      bill_image TEXT DEFAULT '',
      payment_proof TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
      submitted_date TEXT NOT NULL,
      actioned_by TEXT,
      actioned_at TEXT,
      paid_at TEXT,
      FOREIGN KEY(worker_id) REFERENCES users(id),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
  `);
  saveDb();
}

async function seedData() {
  const existing = db.exec("SELECT COUNT(*) as cnt FROM users");
  if (existing[0].values[0][0] > 0) return;

  const SALT_ROUNDS = 10;
  const hashes = await Promise.all([
    bcrypt.hash('1111', SALT_ROUNDS),
    bcrypt.hash('2222', SALT_ROUNDS),
    bcrypt.hash('3333', SALT_ROUNDS),
    bcrypt.hash('4444', SALT_ROUNDS),
    bcrypt.hash('0000', SALT_ROUNDS),
  ]);

  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)`, ['w1','Raju Kumar',   hashes[0],'worker',600,'9876543210']);
  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)`, ['w2','Sunita Devi',  hashes[1],'worker',550,'9876543211']);
  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)`, ['w3','Mohan Lal',    hashes[2],'worker',650,'9876543212']);
  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)`, ['w4','Priya Sharma', hashes[3],'worker',580,'9876543213']);
  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)`, ['mgr','Harjeet Singh',hashes[4],'manager',0,'9812345678']);

  db.run(`INSERT OR IGNORE INTO projects VALUES
    ('p1','Sector 62 Housing Block','Sector 62, Noida','construction','Ramesh Verma','2026-01-15','2026-08-30','active','3-storey residential housing block, 24 units'),
    ('p2','NH-58 Road Widening','Ghaziabad Bypass, UP','road','Suresh Gupta','2025-11-01','2026-06-30','active','6-lane highway widening, 4km stretch'),
    ('p3','Patiala Grain Market Renovation','Old Grain Market, Patiala','renovation','Harjeet Singh','2026-03-01','2026-07-15','active','Structural renovation of heritage market complex'),
    ('p4','Model Town Water Pipeline','Model Town, Ludhiana','maintenance','Ajay Sharma','2026-04-10','2026-09-30','active','Underground water pipeline laying, 2km'),
    ('p5','IT Park Boundary Wall','Chandigarh Industrial Area','construction','Navneet Kaur','2026-02-20','2026-05-31','on-hold','Security boundary wall for IT park')
  `);

  saveDb();
}

// ── PIN helpers (bcrypt) ─────────────────────────────────────────────────────
async function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}

async function verifyPin(plain, hashed) {
  // Support legacy plaintext PINs during migration
  if (!hashed.startsWith('$2')) return plain === hashed;
  return bcrypt.compare(plain, hashed);
}

// Query helpers
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = [];
  stmt.bind(params);
  while (stmt.step()) result.push(stmt.getAsObject());
  stmt.free();
  return result;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

module.exports = { getDb, query, run, get, saveDb, hashPin, verifyPin };
