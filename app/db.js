"use strict";
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = process.env.ECOPOINT_DATA || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "ecopoint.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, city TEXT NOT NULL DEFAULT 'Gəncə'
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
  coins INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0, last_deposit_day TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', lat REAL, lng REAL,
  key_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bins (
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, material TEXT NOT NULL,
  fill_kg REAL NOT NULL DEFAULT 0, capacity_kg REAL NOT NULL, PRIMARY KEY (station_id, material)
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, material TEXT NOT NULL,
  items INTEGER NOT NULL, weight_kg REAL NOT NULL, coins INTEGER NOT NULL, bonus INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dep_user ON deposits(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dep_time ON deposits(created_at);
CREATE TABLE IF NOT EXISTS qr_codes (
  code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0, items_total INTEGER NOT NULL DEFAULT 0, coins_total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁', partner_org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
  stock INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE, code TEXT NOT NULL UNIQUE,
  cost INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), used_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', emoji TEXT NOT NULL DEFAULT '🌳',
  goal_coins INTEGER NOT NULL DEFAULT 1000, raised_coins INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, coins INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS achievements_unlocked (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS waste_logs (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, month TEXT NOT NULL,
  total_kg REAL NOT NULL, UNIQUE (org_id, month)
);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, material TEXT NOT NULL,
  kg REAL NOT NULL, revenue REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY, advertiser TEXT NOT NULL, text TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '📢',
  monthly_price REAL NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/* ---------------- constants ---------------- */
const MATERIALS = ["plastik", "kagiz", "shushe", "metal"];
const MATERIAL_LABEL = { plastik: "Plastik", kagiz: "Kağız", shushe: "Şüşə", metal: "Metal" };
const DEFAULT_SETTINGS = {
  rates: {
    plastik: { coins: 10, kg: 0.025, price: 0.45, co2: 1.5, capacity: 40 },
    kagiz: { coins: 6, kg: 0.1, price: 0.12, co2: 0.9, capacity: 80 },
    shushe: { coins: 8, kg: 0.35, price: 0.06, co2: 0.3, capacity: 120 },
    metal: { coins: 12, kg: 0.03, price: 0.8, co2: 4.0, capacity: 60 },
  },
};

function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key='main'").get();
  return row ? JSON.parse(row.value) : DEFAULT_SETTINGS;
}
function saveSettings(s) {
  db.prepare("INSERT INTO settings(key,value) VALUES('main',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(s));
}

/* ---------------- crypto helpers ---------------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newKey = () => crypto.randomBytes(18).toString("hex");

/* ---------------- time helpers (Azerbaijan, UTC+4) ---------------- */
const AZ_OFFSET = 4 * 3600 * 1000;
const dayStr = (ts = Date.now()) => new Date(ts + AZ_OFFSET).toISOString().slice(0, 10);
const monthStr = (ts = Date.now()) => new Date(ts + AZ_OFFSET).toISOString().slice(0, 7);
function monthRangeUtc(month) {
  // returns [startSql, endSql] in UTC "YYYY-MM-DD HH:MM:SS" for an Azerbaijan-local month
  const [y, m] = month.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) - AZ_OFFSET;
  const end = Date.UTC(y, m, 1) - AZ_OFFSET;
  const f = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
  return [f(start), f(end)];
}

/* ---------------- seed ---------------- */
function seed() {
  if (db.prepare("SELECT COUNT(*) c FROM orgs").get().c > 0) return null;
  const out = { keys: [], adminPassword: null };
  const rates = getSettings().rates;
  saveSettings(getSettings());

  const insOrg = db.prepare("INSERT INTO orgs(name,type) VALUES(?,?)");
  const orgs = {};
  [
    ["Gəncə Dövlət Universiteti", "university"],
    ["Azərbaycan Texnologiya Universiteti", "university"],
    ["Gəncə Aqrar Universiteti", "university"],
    ["Kafe Nizami", "partner"],
    ["Kitab Dünyası", "partner"],
    ["Market+", "partner"],
  ].forEach(([n, t]) => (orgs[n] = insOrg.run(n, t).lastInsertRowid));

  const insUser = db.prepare("INSERT INTO users(name,email,pass_hash,role,org_id,is_demo) VALUES(?,?,?,?,?,?)");
  const adminPw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  insUser.run("Administrator", "admin@ecopoint.az", hashPassword(adminPw), "admin", null, 0);
  out.adminPassword = adminPw;
  const demoPw = hashPassword("demo1234");
  const demoUser = insUser.run("Demo İstifadəçi", "demo@ecopoint.az", demoPw, "user", orgs["Gəncə Dövlət Universiteti"], 0).lastInsertRowid;
  insUser.run("GDU Təşkilat Meneceri", "gdu@ecopoint.az", demoPw, "business", orgs["Gəncə Dövlət Universiteti"], 0);
  insUser.run("Kafe Nizami", "kafe@ecopoint.az", demoPw, "business", orgs["Kafe Nizami"], 0);

  const insStation = db.prepare("INSERT INTO stations(name,address,lat,lng,key_hash) VALUES(?,?,?,?,?)");
  const insBin = db.prepare("INSERT INTO bins(station_id,material,fill_kg,capacity_kg) VALUES(?,?,?,?)");
  const stationIds = [];
  [
    ["EcoPoint #1 — Universitet", "Gəncə Dövlət Universiteti, mərkəzi korpus", 40.6828, 46.3606],
    ["EcoPoint #2 — Park", "Şəhər parkı, giriş meydançası", 40.6805, 46.3545],
    ["EcoPoint #3 — Mərkəz", "Şəhər mərkəzi, ticarət məntəqəsi", 40.6859, 46.3662],
  ].forEach(([n, a, lat, lng], i) => {
    const key = newKey();
    const id = insStation.run(n, a, lat, lng, sha256(key)).lastInsertRowid;
    stationIds.push(id);
    out.keys.push({ id, name: n, key });
    MATERIALS.forEach((m) => insBin.run(id, m, 0, rates[m].capacity));
  });

  const insReward = db.prepare("INSERT INTO rewards(title,description,cost,emoji,partner_org_id,stock) VALUES(?,?,?,?,?,?)");
  insReward.run("5 AZN endirim", "Kafe Nizami-də 5 AZN endirim kuponu", 500, "☕", orgs["Kafe Nizami"], null);
  insReward.run("Pulsuz içki", "Kafe Nizami-də istənilən içki", 750, "🥤", orgs["Kafe Nizami"], null);
  insReward.run("Kitab endirimi 10%", "Kitab Dünyası mağazasında 10% endirim", 300, "📚", orgs["Kitab Dünyası"], null);
  insReward.run("Market kuponu", "Market+ üçün 10 AZN alış-veriş kuponu", 1000, "🛒", orgs["Market+"], null);

  const insProj = db.prepare("INSERT INTO projects(title,description,emoji,goal_coins,raised_coins) VALUES(?,?,?,?,?)");
  insProj.run("Ağacəkmə aksiyası", "Hər 100 EcoCoin ilə şəhər parklarında yeni ağac əkilir.", "🌳", 5000, 0);
  insProj.run("Yaşıllaşdırma", "Məktəb həyətlərinin və yaşıl zonaların abadlaşdırılması.", "🌱", 4000, 0);
  insProj.run("Su hövzələrinin təmizlənməsi", "Çay və göl sahillərinin tullantılardan təmizlənməsi.", "🌊", 6000, 0);

  const insAd = db.prepare("INSERT INTO ads(advertiser,text,emoji,monthly_price) VALUES(?,?,?,?)");
  insAd.run("Kafe Nizami", "EcoCoin ilə pulsuz içki — Kafe Nizami", "☕", 100);
  insAd.run("Kitab Dünyası", "Kitab Dünyası: EcoCoin sahiblərinə 10% endirim", "📚", 100);

  /* demo community (clearly flagged as demo accounts) */
  if (process.env.ECOPOINT_SEED_DEMO !== "0") {
    const names = [
      ["Aysel Məmmədova", "Gəncə Dövlət Universiteti"], ["Rauf Əliyev", "Gəncə Dövlət Universiteti"],
      ["Nigar Həsənova", "Azərbaycan Texnologiya Universiteti"], ["Elvin Quliyev", "Azərbaycan Texnologiya Universiteti"],
      ["Leyla Hüseynova", "Gəncə Aqrar Universiteti"], ["Tural Babayev", "Gəncə Aqrar Universiteti"],
      ["Səbinə Rzayeva", "Gəncə Dövlət Universiteti"], ["Orxan Nəbiyev", "Azərbaycan Texnologiya Universiteti"],
    ];
    const dummy = hashPassword(crypto.randomBytes(12).toString("hex"));
    const insDep = db.prepare("INSERT INTO deposits(user_id,station_id,material,items,weight_kg,coins,bonus,created_at) VALUES(?,?,?,?,?,?,?,?)");
    const updUser = db.prepare("UPDATE users SET coins=coins+?, earned=earned+?, xp=xp+?, streak=?, last_deposit_day=? WHERE id=?");
    const updBin = db.prepare("UPDATE bins SET fill_kg=fill_kg+? WHERE station_id=? AND material=?");
    let seedN = 7;
    const rnd = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
    const tx = db.transaction(() => {
      names.forEach(([nm, org], i) => {
        const uid = insUser.run(nm, `demo${i + 1}@demo.ecopoint.az`, dummy, "user", orgs[org], 1).lastInsertRowid;
        const activity = 0.35 + rnd() * 0.6;
        let coins = 0;
        for (let d = 29; d >= 0; d--) {
          if (rnd() > activity) continue;
          const ts = Date.now() - d * 86400000 - Math.floor(rnd() * 8) * 3600000;
          const when = new Date(ts).toISOString().slice(0, 19).replace("T", " ");
          const k = 1 + Math.floor(rnd() * 2);
          for (let j = 0; j < k; j++) {
            const mat = MATERIALS[Math.floor(rnd() * 4)];
            const items = 1 + Math.floor(rnd() * 9);
            const c = items * rates[mat].coins;
            const sid = stationIds[Math.floor(rnd() * 3)];
            insDep.run(uid, sid, mat, items, +(items * rates[mat].kg).toFixed(3), c, 0, when);
            updBin.run(items * rates[mat].kg, sid, mat);
            coins += c;
          }
        }
        updUser.run(coins, coins, coins, 1 + Math.floor(rnd() * 5), dayStr(), uid);
      });
      // light history for the demo user too
      const d0 = Date.now() - 2 * 86400000;
      [["plastik", 5], ["kagiz", 3], ["shushe", 2]].forEach(([mat, items], i) => {
        const c = items * rates[mat].coins;
        insDep.run(demoUser, stationIds[0], mat, items, +(items * rates[mat].kg).toFixed(3), c, 0, new Date(d0 + i * 3600000).toISOString().slice(0, 19).replace("T", " "));
        updUser.run(c, c, c, 1, dayStr(d0), demoUser);
      });
    });
    tx();
    const ukeep = db.prepare("SELECT COUNT(*) c FROM deposits").get().c;
    void ukeep;
  }
  return out;
}

module.exports = {
  db, DATA_DIR, MATERIALS, MATERIAL_LABEL, getSettings, saveSettings, hashPassword, verifyPassword, sha256, newKey,
  dayStr, monthStr, monthRangeUtc, seed,
};
