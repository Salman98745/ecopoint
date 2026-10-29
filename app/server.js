"use strict";
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const D = require("./db");
const { db, MATERIALS, MATERIAL_LABEL } = D;

const PORT = Number(process.env.PORT) || 3000;
const COOKIE = "ep_sid";
const SESSION_MS = 14 * 24 * 3600 * 1000;

const seeded = D.seed();
if (seeded) {
  const lines = ["EcoPoint — ilk işə salınma", "", `Admin: admin@ecopoint.az / ${seeded.adminPassword}`, "Demo: demo@ecopoint.az, gdu@ecopoint.az, kafe@ecopoint.az / demo1234", "", "Məntəqə açarları (kiosk üçün):"];
  seeded.keys.forEach((k) => lines.push(`  #${k.id} ${k.name}: ${k.key}`));
  fs.writeFileSync(path.join(D.DATA_DIR, "ilk-melumatlar.txt"), lines.join("\n") + "\n", { mode: 0o600 });
  console.log(lines.join("\n"));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const byMat = (a, b) => MATERIALS.indexOf(a.material) - MATERIALS.indexOf(b.material);

/* ---------------- validation ---------------- */
function str(v, name, min, max) {
  if (typeof v !== "string") throw bad(`${name} düzgün deyil`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} ${min}–${max} simvol olmalıdır`);
  return s;
}
function int(v, name, min, max) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} ${min}–${max} aralığında tam ədəd olmalıdır`);
  return n;
}
function num(v, name, min, max) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw bad(`${name} ${min}–${max} aralığında olmalıdır`);
  return n;
}
const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const material = (m) => { if (!MATERIALS.includes(m)) throw bad("Material növü düzgün deyil"); return m; };

/* ---------------- rate limit (in-memory) ---------------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length > max;
}

/* ---------------- game rules ---------------- */
const LEVELS = [
  { min: 0, name: "Yeni başlayan", emoji: "🌱" },
  { min: 100, name: "Çeşidləyən", emoji: "♻️" },
  { min: 400, name: "Eko-dost", emoji: "🐢" },
  { min: 1000, name: "Eko-qəhrəman", emoji: "🦸" },
  { min: 2500, name: "Planet qoruyucusu", emoji: "🌍" },
  { min: 5000, name: "Eko-lider", emoji: "👑" },
];
function levelFor(xp) {
  let i = 0;
  LEVELS.forEach((l, idx) => { if (xp >= l.min) i = idx; });
  const cur = LEVELS[i], nxt = LEVELS[i + 1] || null;
  return { level: i + 1, name: cur.name, emoji: cur.emoji, xp, next: nxt ? nxt.min : null, progress: nxt ? Math.min(1, (xp - cur.min) / (nxt.min - cur.min)) : 1 };
}

const ACHIEVEMENTS = [
  { key: "first", emoji: "🥉", title: "İlk addım", desc: "İlk tullantını təhvil ver", test: (s) => s.deposits >= 1 },
  { key: "plastic10", emoji: "🥤", title: "Plastik ustası", desc: "10 plastik əşya təhvil ver", test: (s) => s.items.plastik >= 10 },
  { key: "paper10", emoji: "📄", title: "Kağız dostu", desc: "10 kağız tullantısı təhvil ver", test: (s) => s.items.kagiz >= 10 },
  { key: "glass5", emoji: "🍾", title: "Şüşə qoruyucusu", desc: "5 şüşə təhvil ver", test: (s) => s.items.shushe >= 5 },
  { key: "metal5", emoji: "🔩", title: "Metal döyüşçüsü", desc: "5 metal təhvil ver", test: (s) => s.items.metal >= 5 },
  { key: "all4", emoji: "🧩", title: "Dörd material", desc: "Dörd materialın hamısından təhvil ver", test: (s) => MATERIALS.every((m) => s.items[m] > 0) },
  { key: "streak3", emoji: "🔥", title: "3 günlük seriya", desc: "Ardıcıl 3 gün təhvil ver", test: (s) => s.streak >= 3 },
  { key: "streak7", emoji: "⚡", title: "Həftəlik seriya", desc: "Ardıcıl 7 gün təhvil ver", test: (s) => s.streak >= 7 },
  { key: "kg10", emoji: "⚖️", title: "10 kq klubu", desc: "Cəmi 10 kq təhvil ver", test: (s) => s.kg >= 10 },
  { key: "coins500", emoji: "🪙", title: "500 EcoCoin", desc: "Ümumilikdə 500 EcoCoin qazan", test: (s) => s.earned >= 500 },
  { key: "donor", emoji: "🌳", title: "Yaxşılıq edən", desc: "İlk bağışını et", test: (s) => s.donations >= 1 },
  { key: "redeemer", emoji: "🎁", title: "Mükafat ovçusu", desc: "İlk mükafatını seç", test: (s) => s.redemptions >= 1 },
];

function userStats(uid) {
  const u = db.prepare("SELECT coins, earned, xp, streak FROM users WHERE id=?").get(uid);
  const rows = db.prepare("SELECT material, SUM(items) items, SUM(weight_kg) kg, COUNT(*) n FROM deposits WHERE user_id=? GROUP BY material").all(uid);
  const items = {}, kgBy = {};
  MATERIALS.forEach((m) => { items[m] = 0; kgBy[m] = 0; });
  let deposits = 0, kg = 0;
  rows.forEach((r) => { items[r.material] = r.items; kgBy[r.material] = r.kg; deposits += r.n; kg += r.kg; });
  return {
    coins: u.coins, earned: u.earned, xp: u.xp, streak: u.streak, items, kgBy, kg, deposits,
    donations: db.prepare("SELECT COUNT(*) c FROM donations WHERE user_id=?").get(uid).c,
    redemptions: db.prepare("SELECT COUNT(*) c FROM redemptions WHERE user_id=?").get(uid).c,
  };
}
function impactOf(kgBy) {
  const rates = D.getSettings().rates;
  let co2 = 0;
  MATERIALS.forEach((m) => (co2 += (kgBy[m] || 0) * rates[m].co2));
  return { co2: +co2.toFixed(2), trees: +(((kgBy.kagiz || 0) * 0.017)).toFixed(2) };
}
function checkAchievements(uid) {
  const s = userStats(uid);
  const have = new Set(db.prepare("SELECT key FROM achievements_unlocked WHERE user_id=?").all(uid).map((r) => r.key));
  const fresh = [];
  const ins = db.prepare("INSERT OR IGNORE INTO achievements_unlocked(user_id,key) VALUES(?,?)");
  ACHIEVEMENTS.forEach((a) => { if (!have.has(a.key) && a.test(s)) { ins.run(uid, a.key); fresh.push({ key: a.key, emoji: a.emoji, title: a.title }); } });
  return fresh;
}

/* ---------------- SSE hub ---------------- */
const streams = new Map();
function push(uid, event, data) {
  const set = streams.get(uid);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  set.forEach((res) => res.write(msg));
}

/* ---------------- app ---------------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=()",
  });
  next();
});
app.use(express.json({ limit: "50kb" }));

// CSRF defence: mutating requests must be JSON and same-origin
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON tələb olunur" });
    const origin = req.get("origin");
    if (origin) { try { if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Başqa mənbədən sorğu" }); } catch { return res.status(403).json({ error: "Origin düzgün deyil" }); } }
  }
  next();
});

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(req, res, token) {
  const secure = req.secure || process.env.COOKIE_SECURE === "1";
  res.append("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`);
}
function createSession(req, res, uid) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(D.sha256(token), uid, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token);
}
app.use((req, res, next) => {
  const token = parseCookies(req)[COOKIE];
  req.user = null;
  if (token) {
    const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").get(D.sha256(token), Date.now());
    if (row) req.user = row;
    req.token = token;
  }
  next();
});
const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Daxil olun" });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: "İcazə yoxdur" });
  next();
};
const route = (fn) => (req, res, next) => { try { const r = fn(req, res); if (r && typeof r.then === "function") r.catch(next); } catch (e) { next(e); } };

const shortName = (n) => { const p = String(n).split(" "); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
function publicUser(u) {
  const org = u.org_id ? db.prepare("SELECT id,name,type FROM orgs WHERE id=?").get(u.org_id) : null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, org, coins: u.coins, earned: u.earned, streak: u.streak, level: levelFor(u.xp) };
}

/* ================= public ================= */
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/public/stats", route((req, res) => {
  const t = db.prepare("SELECT COUNT(*) deposits, COALESCE(SUM(weight_kg),0) kg, COALESCE(SUM(items),0) items FROM deposits").get();
  res.json({ users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c, deposits: t.deposits, kg: +t.kg.toFixed(1), items: t.items, stations: db.prepare("SELECT COUNT(*) c FROM stations WHERE active=1").get().c });
}));
app.get("/api/orgs", route((req, res) => res.json(db.prepare("SELECT id,name,type FROM orgs ORDER BY type DESC,name").all())));
app.get("/api/config", route((req, res) => res.json({ rates: D.getSettings().rates, levels: LEVELS, achievements: ACHIEVEMENTS.map(({ test, ...a }) => a), labels: MATERIAL_LABEL })));

/* ================= auth ================= */
app.post("/api/auth/register", route((req, res) => {
  if (limited("reg:" + req.ip, 8, 3600000)) throw new HttpError(429, "Çox sayda cəhd, bir az sonra yenidən yoxlayın");
  const name = str(req.body.name, "Ad", 2, 60);
  const email = str(req.body.email, "E-poçt", 5, 254).toLowerCase();
  const password = str(req.body.password, "Parol", 8, 100);
  if (!emailOk(email)) throw bad("E-poçt düzgün deyil");
  let orgId = null;
  if (req.body.org_id) {
    orgId = int(req.body.org_id, "Təşkilat", 1, 1e9);
    if (!db.prepare("SELECT 1 FROM orgs WHERE id=? AND type<>'partner'").get(orgId)) throw bad("Təşkilat tapılmadı");
  }
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) throw new HttpError(409, "Bu e-poçt artıq qeydiyyatdan keçib");
  const id = db.prepare("INSERT INTO users(name,email,pass_hash,role,org_id) VALUES(?,?,?,'user',?)").run(name, email, D.hashPassword(password), orgId).lastInsertRowid;
  createSession(req, res, id);
  res.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)) });
}));
app.post("/api/auth/login", route((req, res) => {
  if (limited("login:" + req.ip, 15, 60000)) throw new HttpError(429, "Çox sayda cəhd, bir dəqiqə gözləyin");
  const email = str(req.body.email, "E-poçt", 3, 254).toLowerCase();
  const password = str(req.body.password, "Parol", 1, 100);
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  const okPw = u ? D.verifyPassword(password, u.pass_hash) : (D.verifyPassword(password, "scrypt$00$00"), false);
  if (!u || !okPw) throw new HttpError(401, "E-poçt və ya parol yanlışdır");
  createSession(req, res, u.id);
  res.json({ user: publicUser(u) });
}));
app.post("/api/auth/logout", route((req, res) => {
  if (req.token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(D.sha256(req.token));
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));
app.get("/api/me", route((req, res) => res.json({ user: req.user ? publicUser(req.user) : null })));
app.patch("/api/me", need(), route((req, res) => {
  const name = str(req.body.name, "Ad", 2, 60);
  let orgId = req.user.org_id;
  if (req.body.org_id !== undefined && req.user.role === "user") {
    orgId = req.body.org_id ? int(req.body.org_id, "Təşkilat", 1, 1e9) : null;
    if (orgId && !db.prepare("SELECT 1 FROM orgs WHERE id=? AND type<>'partner'").get(orgId)) throw bad("Təşkilat tapılmadı");
  }
  db.prepare("UPDATE users SET name=?, org_id=? WHERE id=?").run(name, orgId, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)) });
}));
app.post("/api/me/password", need(), route((req, res) => {
  if (!D.verifyPassword(str(req.body.current, "Cari parol", 1, 100), req.user.pass_hash)) throw new HttpError(403, "Cari parol yanlışdır");
  const np = str(req.body.next, "Yeni parol", 8, 100);
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(D.hashPassword(np), req.user.id);
  db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(req.user.id, D.sha256(req.token));
  res.json({ ok: true });
}));

/* ================= user ================= */
app.get("/api/me/overview", need(), route((req, res) => {
  const s = userStats(req.user.id);
  const [from, to] = D.monthRangeUtc(D.monthStr());
  const monthCoins = db.prepare("SELECT COALESCE(SUM(coins+bonus),0) c FROM deposits WHERE user_id=? AND created_at>=? AND created_at<?").get(req.user.id, from, to).c;
  const rank = db.prepare(`SELECT COUNT(*)+1 r FROM (SELECT user_id, SUM(coins+bonus) c FROM deposits WHERE created_at>=? AND created_at<? GROUP BY user_id) WHERE c > ?`).get(from, to, monthCoins).r;
  const today = D.dayStr();
  const streakAlive = req.user.last_deposit_day === today || req.user.last_deposit_day === D.dayStr(Date.now() - 86400000);
  res.json({
    user: publicUser(req.user), stats: { items: s.items, kgBy: s.kgBy, kg: +s.kg.toFixed(2), deposits: s.deposits },
    impact: impactOf(s.kgBy), monthCoins, rank: monthCoins > 0 ? rank : null, streak: streakAlive ? req.user.streak : 0, doneToday: req.user.last_deposit_day === today,
    recent: db.prepare("SELECT d.id,d.material,d.items,d.weight_kg,d.coins,d.bonus,d.created_at,s.name station FROM deposits d JOIN stations s ON s.id=d.station_id WHERE d.user_id=? ORDER BY d.id DESC LIMIT 8").all(req.user.id),
  });
}));
app.get("/api/me/deposits", need(), route((req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  res.json(db.prepare("SELECT d.id,d.material,d.items,d.weight_kg,d.coins,d.bonus,d.created_at,s.name station FROM deposits d JOIN stations s ON s.id=d.station_id WHERE d.user_id=? ORDER BY d.id DESC LIMIT ?").all(req.user.id, limit));
}));
app.get("/api/me/achievements", need(), route((req, res) => {
  const have = new Map(db.prepare("SELECT key, unlocked_at FROM achievements_unlocked WHERE user_id=?").all(req.user.id).map((r) => [r.key, r.unlocked_at]));
  res.json(ACHIEVEMENTS.map(({ test, ...a }) => ({ ...a, unlocked: have.has(a.key), unlocked_at: have.get(a.key) || null })));
}));

const QR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
app.post("/api/me/qr", need(), route(async (req, res) => {
  if (limited("qr:" + req.user.id, 30, 60000)) throw new HttpError(429, "Çox tez-tez sorğu");
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += QR_ALPHABET[bytes[i] % QR_ALPHABET.length];
  const expires = Date.now() + 120000;
  db.prepare("DELETE FROM qr_codes WHERE user_id=? OR expires_at<?").run(req.user.id, Date.now());
  db.prepare("INSERT INTO qr_codes(code,user_id,expires_at) VALUES(?,?,?)").run(code, req.user.id, expires);
  const svg = await QRCode.toString(`EP:${code}`, { type: "svg", margin: 1, color: { dark: "#0d3b2a", light: "#ffffff" } });
  res.json({ code, svg, expiresAt: expires });
}));

app.get("/api/stations", route((req, res) => {
  const rows = db.prepare("SELECT id,name,address,lat,lng,active FROM stations WHERE active=1 ORDER BY id").all();
  const bins = db.prepare("SELECT material,fill_kg,capacity_kg FROM bins WHERE station_id=?");
  res.json(rows.map((s) => ({ ...s, bins: bins.all(s.id).map((b) => ({ material: b.material, pct: Math.min(100, Math.round((b.fill_kg / b.capacity_kg) * 100)) })) })));
}));

app.get("/api/rewards", need(), route((req, res) => {
  res.json(db.prepare("SELECT r.id,r.title,r.description,r.cost,r.emoji,r.stock,o.name partner FROM rewards r LEFT JOIN orgs o ON o.id=r.partner_org_id WHERE r.active=1 ORDER BY r.cost").all());
}));
function newCouponCode() {
  let code = "EP-";
  const b = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) { code += QR_ALPHABET[b[i] % QR_ALPHABET.length]; if (i === 3) code += "-"; }
  return code;
}
app.post("/api/rewards/:id/redeem", need(), route((req, res) => {
  const rid = int(req.params.id, "Mükafat", 1, 1e9);
  const tx = db.transaction(() => {
    const r = db.prepare("SELECT * FROM rewards WHERE id=? AND active=1").get(rid);
    if (!r) throw new HttpError(404, "Mükafat tapılmadı");
    if (r.stock !== null && r.stock <= 0) throw new HttpError(409, "Mükafat bitib");
    const u = db.prepare("SELECT coins FROM users WHERE id=?").get(req.user.id);
    if (u.coins < r.cost) throw new HttpError(409, "EcoCoin kifayət etmir");
    db.prepare("UPDATE users SET coins=coins-? WHERE id=?").run(r.cost, req.user.id);
    if (r.stock !== null) db.prepare("UPDATE rewards SET stock=stock-1 WHERE id=?").run(rid);
    const code = newCouponCode();
    const id = db.prepare("INSERT INTO redemptions(user_id,reward_id,code,cost) VALUES(?,?,?,?)").run(req.user.id, rid, code, r.cost).lastInsertRowid;
    return { id, code, title: r.title, emoji: r.emoji, cost: r.cost };
  });
  const out = tx();
  const fresh = checkAchievements(req.user.id);
  fresh.forEach((a) => push(req.user.id, "achievement", a));
  res.status(201).json({ redemption: out, balance: db.prepare("SELECT coins FROM users WHERE id=?").get(req.user.id).coins, achievements: fresh });
}));
app.get("/api/me/redemptions", need(), route((req, res) => {
  res.json(db.prepare("SELECT x.id,x.code,x.status,x.cost,x.created_at,x.used_at,r.title,r.emoji,o.name partner FROM redemptions x JOIN rewards r ON r.id=x.reward_id LEFT JOIN orgs o ON o.id=r.partner_org_id WHERE x.user_id=? ORDER BY x.id DESC LIMIT 50").all(req.user.id));
}));

app.get("/api/projects", need(), route((req, res) => {
  res.json(db.prepare("SELECT id,title,description,emoji,goal_coins,raised_coins FROM projects WHERE active=1 ORDER BY id").all());
}));
app.post("/api/projects/:id/donate", need(), route((req, res) => {
  const pid = int(req.params.id, "Layihə", 1, 1e9);
  const coins = int(req.body.coins, "Məbləğ", 10, 1000000);
  const tx = db.transaction(() => {
    const p = db.prepare("SELECT * FROM projects WHERE id=? AND active=1").get(pid);
    if (!p) throw new HttpError(404, "Layihə tapılmadı");
    const u = db.prepare("SELECT coins FROM users WHERE id=?").get(req.user.id);
    if (u.coins < coins) throw new HttpError(409, "EcoCoin kifayət etmir");
    db.prepare("UPDATE users SET coins=coins-? WHERE id=?").run(coins, req.user.id);
    db.prepare("UPDATE projects SET raised_coins=raised_coins+? WHERE id=?").run(coins, pid);
    db.prepare("INSERT INTO donations(user_id,project_id,coins) VALUES(?,?,?)").run(req.user.id, pid, coins);
    return p;
  });
  const p = tx();
  const fresh = checkAchievements(req.user.id);
  fresh.forEach((a) => push(req.user.id, "achievement", a));
  res.json({ ok: true, project: p.title, balance: db.prepare("SELECT coins FROM users WHERE id=?").get(req.user.id).coins, achievements: fresh });
}));

app.get("/api/leaderboard", need(), route((req, res) => {
  const period = req.query.period === "all" ? "all" : "month";
  const [from, to] = period === "month" ? D.monthRangeUtc(D.monthStr()) : ["1970-01-01 00:00:00", "9999-01-01 00:00:00"];
  const users = db.prepare(`SELECT u.id, u.name, u.is_demo, o.name org, SUM(d.coins+d.bonus) pts, SUM(d.weight_kg) kg FROM deposits d JOIN users u ON u.id=d.user_id LEFT JOIN orgs o ON o.id=u.org_id WHERE d.created_at>=? AND d.created_at<? GROUP BY u.id ORDER BY pts DESC LIMIT 20`).all(from, to)
    .map((r, i) => ({ rank: i + 1, name: shortName(r.name), org: r.org, pts: r.pts, kg: +r.kg.toFixed(2), me: r.id === req.user.id, demo: !!r.is_demo }));
  const orgs = db.prepare(`SELECT o.id, o.name, o.type, SUM(d.coins+d.bonus) pts, SUM(d.weight_kg) kg, COUNT(DISTINCT u.id) members FROM deposits d JOIN users u ON u.id=d.user_id JOIN orgs o ON o.id=u.org_id WHERE o.type<>'partner' AND d.created_at>=? AND d.created_at<? GROUP BY o.id ORDER BY pts DESC LIMIT 20`).all(from, to)
    .map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, type: r.type, pts: r.pts, kg: +r.kg.toFixed(2), members: r.members, mine: r.id === req.user.org_id }));
  res.json({ period, users, orgs });
}));

/* ================= kiosk (station hardware / simulator) ================= */
function kioskAuth(req, res, next) {
  const id = Number(req.get("x-station-id")), key = req.get("x-station-key") || "";
  const st = Number.isInteger(id) ? db.prepare("SELECT * FROM stations WHERE id=? AND active=1").get(id) : null;
  if (!st || limited("kauth:" + id, 600, 60000)) return res.status(401).json({ error: "Məntəqə doğrulanmadı" });
  const a = Buffer.from(D.sha256(key)), b = Buffer.from(st.key_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Məntəqə açarı yanlışdır" });
  req.station = st;
  next();
}
function binsOf(stationId) {
  return db.prepare("SELECT material,fill_kg,capacity_kg FROM bins WHERE station_id=?").all(stationId).sort(byMat).map((b) => ({ material: b.material, fill_kg: +b.fill_kg.toFixed(2), capacity_kg: b.capacity_kg, pct: Math.min(100, Math.round((b.fill_kg / b.capacity_kg) * 100)), full: b.fill_kg >= b.capacity_kg - 0.001 }));
}
app.get("/api/kiosk/state", kioskAuth, route((req, res) => {
  res.json({ station: { id: req.station.id, name: req.station.name, address: req.station.address }, bins: binsOf(req.station.id), ads: db.prepare("SELECT advertiser,text,emoji FROM ads WHERE active=1 ORDER BY id").all(), rates: D.getSettings().rates, labels: MATERIAL_LABEL });
}));
app.post("/api/kiosk/identify", kioskAuth, route((req, res) => {
  if (limited("kid:" + req.station.id, 20, 60000)) throw new HttpError(429, "Çox sayda cəhd");
  let code = str(req.body.code, "Kod", 4, 40).toUpperCase().replace(/^EP:/, "").replace(/[^A-Z0-9]/g, "");
  const row = db.prepare("SELECT * FROM qr_codes WHERE code=? AND expires_at>?").get(code, Date.now());
  if (!row) throw new HttpError(404, "Kod tapılmadı və ya vaxtı bitib");
  db.prepare("DELETE FROM qr_codes WHERE code=?").run(code);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id);
  const sid = crypto.randomBytes(12).toString("hex");
  db.prepare("INSERT INTO kiosk_sessions(id,user_id,station_id,expires_at) VALUES(?,?,?,?)").run(sid, u.id, req.station.id, Date.now() + 180000);
  const s = userStats(u.id);
  push(u.id, "connected", { station: req.station.name });
  res.json({ sessionId: sid, user: { name: u.name, first: u.name.split(" ")[0], coins: u.coins, level: levelFor(u.xp), streak: u.streak }, stats: { kg: +s.kg.toFixed(2), items: s.items, impact: impactOf(s.kgBy) } });
}));
function kioskSession(req) {
  const sid = str(req.body.sessionId || req.params.sid || "", "Sessiya", 8, 64);
  const ks = db.prepare("SELECT * FROM kiosk_sessions WHERE id=? AND station_id=?").get(sid, req.station.id);
  if (!ks || ks.closed || ks.expires_at < Date.now()) throw new HttpError(410, "Sessiya bitib");
  return ks;
}
app.post("/api/kiosk/deposit", kioskAuth, route((req, res) => {
  const ks = kioskSession(req);
  const mat = material(req.body.material);
  const items = int(req.body.items, "Say", 1, 20);
  const rates = D.getSettings().rates;
  const result = db.transaction(() => {
    const bin = db.prepare("SELECT * FROM bins WHERE station_id=? AND material=?").get(req.station.id, mat);
    const weight = +(items * rates[mat].kg).toFixed(3);
    if (!bin || bin.fill_kg + weight > bin.capacity_kg + 1e-9) throw new HttpError(409, `${MATERIAL_LABEL[mat]} bölməsi dolub`);
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(ks.user_id);
    const today = D.dayStr();
    let streak = u.streak, bonus = 0;
    if (u.last_deposit_day !== today) {
      streak = u.last_deposit_day === D.dayStr(Date.now() - 86400000) ? u.streak + 1 : 1;
      bonus = Math.min(streak, 7) * 2;
    }
    const coins = items * rates[mat].coins;
    const total = coins + bonus;
    db.prepare("INSERT INTO deposits(user_id,station_id,material,items,weight_kg,coins,bonus) VALUES(?,?,?,?,?,?,?)").run(u.id, req.station.id, mat, items, weight, coins, bonus);
    db.prepare("UPDATE bins SET fill_kg=fill_kg+? WHERE station_id=? AND material=?").run(weight, req.station.id, mat);
    db.prepare("UPDATE users SET coins=coins+?, earned=earned+?, xp=xp+?, streak=?, last_deposit_day=? WHERE id=?").run(total, total, total, streak, today, u.id);
    db.prepare("UPDATE kiosk_sessions SET items_total=items_total+?, coins_total=coins_total+?, expires_at=? WHERE id=?").run(items, total, Date.now() + 180000, ks.id);
    return { coins, bonus, total, weight, streak, before: levelFor(u.xp).level };
  })();
  const u2 = db.prepare("SELECT * FROM users WHERE id=?").get(ks.user_id);
  const fresh = checkAchievements(ks.user_id);
  const lvl = levelFor(u2.xp);
  const payload = { material: mat, items, coins: result.coins, bonus: result.bonus, total: result.total, balance: u2.coins, streak: result.streak, level: lvl, levelUp: lvl.level > result.before, achievements: fresh, station: req.station.name };
  push(ks.user_id, "deposit", payload);
  fresh.forEach((a) => push(ks.user_id, "achievement", a));
  res.json({ ...payload, bins: binsOf(req.station.id), message: `Təşəkkürlər! +${result.total} EcoCoin qazandınız!` });
}));
app.post("/api/kiosk/finish", kioskAuth, route((req, res) => {
  const sid = str(req.body.sessionId || "", "Sessiya", 8, 64);
  const ks = db.prepare("SELECT * FROM kiosk_sessions WHERE id=? AND station_id=?").get(sid, req.station.id);
  if (ks) { db.prepare("UPDATE kiosk_sessions SET closed=1 WHERE id=?").run(sid); push(ks.user_id, "finished", { items: ks.items_total, coins: ks.coins_total }); }
  res.json({ ok: true, items: ks ? ks.items_total : 0, coins: ks ? ks.coins_total : 0 });
}));

/* ================= SSE ================= */
app.get("/api/events", need(), (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  const uid = req.user.id;
  if (!streams.has(uid)) streams.set(uid, new Set());
  streams.get(uid).add(res);
  const hb = setInterval(() => res.write(": hb\n\n"), 25000);
  req.on("close", () => { clearInterval(hb); const s = streams.get(uid); if (s) { s.delete(res); if (!s.size) streams.delete(uid); } });
});

/* ================= business ================= */
const bizOrg = (req) => {
  if (!req.user.org_id) throw new HttpError(409, "Hesab təşkilata bağlı deyil");
  return db.prepare("SELECT * FROM orgs WHERE id=?").get(req.user.org_id);
};
app.get("/api/biz/dashboard", need("business", "admin"), route((req, res) => {
  const org = bizOrg(req);
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : D.monthStr();
  const [from, to] = D.monthRangeUtc(month);
  const rows = db.prepare(`SELECT d.material, SUM(d.items) items, SUM(d.weight_kg) kg, SUM(d.coins+d.bonus) coins FROM deposits d JOIN users u ON u.id=d.user_id WHERE u.org_id=? AND d.created_at>=? AND d.created_at<? GROUP BY d.material`).all(org.id, from, to);
  const byMat = {}; MATERIALS.forEach((m) => (byMat[m] = { items: 0, kg: 0, coins: 0 }));
  rows.forEach((r) => (byMat[r.material] = { items: r.items, kg: +r.kg.toFixed(2), coins: r.coins }));
  const sortedKg = +MATERIALS.reduce((a, m) => a + byMat[m].kg, 0).toFixed(2);
  const log = db.prepare("SELECT total_kg FROM waste_logs WHERE org_id=? AND month=?").get(org.id, month);
  const series = [];
  const now = new Date(Date.now() + 4 * 3600000);
  for (let i = 5; i >= 0; i--) {
    const dte = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const mm = dte.toISOString().slice(0, 7);
    const [f, t] = D.monthRangeUtc(mm);
    const kg = db.prepare("SELECT COALESCE(SUM(d.weight_kg),0) kg FROM deposits d JOIN users u ON u.id=d.user_id WHERE u.org_id=? AND d.created_at>=? AND d.created_at<?").get(org.id, f, t).kg;
    series.push({ month: mm, kg: +kg.toFixed(2) });
  }
  const members = db.prepare("SELECT COUNT(*) c FROM users WHERE org_id=? AND role='user'").get(org.id).c;
  const top = db.prepare(`SELECT u.name, SUM(d.coins+d.bonus) pts, SUM(d.weight_kg) kg FROM deposits d JOIN users u ON u.id=d.user_id WHERE u.org_id=? AND d.created_at>=? AND d.created_at<? GROUP BY u.id ORDER BY pts DESC LIMIT 5`).all(org.id, from, to).map((r) => ({ name: shortName(r.name), pts: r.pts, kg: +r.kg.toFixed(2) }));
  const rates = D.getSettings().rates;
  const co2 = +MATERIALS.reduce((a, m) => a + byMat[m].kg * rates[m].co2, 0).toFixed(1);
  res.json({ org, month, byMat, sortedKg, totalLogged: log ? log.total_kg : null, recycledPct: log && log.total_kg > 0 ? Math.min(100, Math.round((sortedKg / log.total_kg) * 100)) : null, series, members, top, co2 });
}));
app.post("/api/biz/waste-log", need("business", "admin"), route((req, res) => {
  const org = bizOrg(req);
  const month = /^\d{4}-\d{2}$/.test(req.body.month || "") ? req.body.month : D.monthStr();
  const kg = num(req.body.total_kg, "Ümumi tullantı", 0, 1e7);
  db.prepare("INSERT INTO waste_logs(org_id,month,total_kg) VALUES(?,?,?) ON CONFLICT(org_id,month) DO UPDATE SET total_kg=excluded.total_kg").run(org.id, month, kg);
  res.json({ ok: true });
}));
app.get("/api/biz/coupons", need("business", "admin"), route((req, res) => {
  const org = bizOrg(req);
  res.json(db.prepare(`SELECT x.id,x.code,x.status,x.created_at,x.used_at,r.title,r.emoji,u.name FROM redemptions x JOIN rewards r ON r.id=x.reward_id JOIN users u ON u.id=x.user_id WHERE r.partner_org_id=? ORDER BY x.id DESC LIMIT 60`).all(org.id).map((r) => ({ ...r, name: shortName(r.name) })));
}));
app.post("/api/biz/coupons/validate", need("business", "admin"), route((req, res) => {
  if (limited("val:" + req.user.id, 40, 60000)) throw new HttpError(429, "Çox sayda cəhd");
  const org = bizOrg(req);
  const code = str(req.body.code, "Kupon kodu", 4, 30).toUpperCase().replace(/\s/g, "");
  const x = db.prepare("SELECT x.*, r.title, r.emoji, r.partner_org_id, u.name FROM redemptions x JOIN rewards r ON r.id=x.reward_id JOIN users u ON u.id=x.user_id WHERE x.code=?").get(code);
  if (!x || (x.partner_org_id !== org.id && req.user.role !== "admin")) throw new HttpError(404, "Kupon tapılmadı");
  if (x.status !== "active") throw new HttpError(409, "Kupon artıq istifadə olunub");
  db.prepare("UPDATE redemptions SET status='used', used_at=datetime('now') WHERE id=? AND status='active'").run(x.id);
  res.json({ ok: true, title: x.title, emoji: x.emoji, customer: shortName(x.name) });
}));

/* ================= admin ================= */
app.get("/api/admin/overview", need("admin"), route((req, res) => {
  const one = (q, ...a) => db.prepare(q).get(...a);
  const kgBy = db.prepare("SELECT material, SUM(weight_kg) kg, SUM(items) items FROM deposits GROUP BY material").all();
  const rates = D.getSettings().rates;
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = D.dayStr(Date.now() - i * 86400000);
    const [f] = [new Date(Date.parse(day + "T00:00:00Z") - 4 * 3600000).toISOString().slice(0, 19).replace("T", " ")];
    const t = new Date(Date.parse(day + "T00:00:00Z") - 4 * 3600000 + 86400000).toISOString().slice(0, 19).replace("T", " ");
    const r = db.prepare("SELECT COALESCE(SUM(weight_kg),0) kg, COUNT(*) n FROM deposits WHERE created_at>=? AND created_at<?").get(f, t);
    series.push({ day: day.slice(5), kg: +r.kg.toFixed(2), n: r.n });
  }
  const bins = db.prepare("SELECT b.*, s.name FROM bins b JOIN stations s ON s.id=b.station_id WHERE s.active=1").all();
  const potential = bins.reduce((a, b) => a + b.fill_kg * rates[b.material].price, 0);
  res.json({
    users: one("SELECT COUNT(*) c FROM users WHERE role='user'").c, deposits: one("SELECT COUNT(*) c FROM deposits").c,
    kgBy, kg: +kgBy.reduce((a, r) => a + r.kg, 0).toFixed(1),
    coinsIssued: one("SELECT COALESCE(SUM(coins+bonus),0) c FROM deposits").c, coinsHeld: one("SELECT COALESCE(SUM(coins),0) c FROM users").c,
    coinsRedeemed: one("SELECT COALESCE(SUM(cost),0) c FROM redemptions").c, coinsDonated: one("SELECT COALESCE(SUM(coins),0) c FROM donations").c,
    revenue: +one("SELECT COALESCE(SUM(revenue),0) r FROM collections").r.toFixed(2), potential: +potential.toFixed(2),
    adRevenue: +one("SELECT COALESCE(SUM(monthly_price),0) r FROM ads WHERE active=1").r.toFixed(2),
    series, alerts: bins.filter((b) => b.fill_kg / b.capacity_kg >= 0.85).map((b) => ({ station: b.name, material: b.material, pct: Math.round((b.fill_kg / b.capacity_kg) * 100) })),
    redemptionsActive: one("SELECT COUNT(*) c FROM redemptions WHERE status='active'").c,
  });
}));
app.get("/api/admin/stations", need("admin"), route((req, res) => {
  const bins = db.prepare("SELECT material,fill_kg,capacity_kg FROM bins WHERE station_id=?");
  const stats = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(weight_kg),0) kg FROM deposits WHERE station_id=?");
  res.json(db.prepare("SELECT id,name,address,lat,lng,active FROM stations ORDER BY id").all().map((s) => ({ ...s, bins: bins.all(s.id).sort(byMat).map((b) => ({ material: b.material, fill_kg: +b.fill_kg.toFixed(2), capacity_kg: b.capacity_kg, pct: Math.min(100, Math.round((b.fill_kg / b.capacity_kg) * 100)) })), totals: (({ n, kg }) => ({ deposits: n, kg: +kg.toFixed(1) }))(stats.get(s.id)) })));
}));
app.post("/api/admin/stations", need("admin"), route((req, res) => {
  const name = str(req.body.name, "Ad", 2, 80), address = str(req.body.address || "", "Ünvan", 0, 160);
  const lat = req.body.lat === "" || req.body.lat == null ? null : num(req.body.lat, "Enlik", -90, 90);
  const lng = req.body.lng === "" || req.body.lng == null ? null : num(req.body.lng, "Uzunluq", -180, 180);
  const key = D.newKey();
  const rates = D.getSettings().rates;
  const id = db.transaction(() => {
    const sid = db.prepare("INSERT INTO stations(name,address,lat,lng,key_hash) VALUES(?,?,?,?,?)").run(name, address, lat, lng, D.sha256(key)).lastInsertRowid;
    MATERIALS.forEach((m) => db.prepare("INSERT INTO bins(station_id,material,fill_kg,capacity_kg) VALUES(?,?,0,?)").run(sid, m, rates[m].capacity));
    return sid;
  })();
  res.status(201).json({ id, key });
}));
app.patch("/api/admin/stations/:id", need("admin"), route((req, res) => {
  const id = int(req.params.id, "Məntəqə", 1, 1e9);
  const s = db.prepare("SELECT * FROM stations WHERE id=?").get(id);
  if (!s) throw new HttpError(404, "Tapılmadı");
  const name = req.body.name !== undefined ? str(req.body.name, "Ad", 2, 80) : s.name;
  const address = req.body.address !== undefined ? str(req.body.address, "Ünvan", 0, 160) : s.address;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : s.active;
  db.prepare("UPDATE stations SET name=?, address=?, active=? WHERE id=?").run(name, address, active, id);
  res.json({ ok: true });
}));
app.post("/api/admin/stations/:id/key", need("admin"), route((req, res) => {
  const id = int(req.params.id, "Məntəqə", 1, 1e9);
  const key = D.newKey();
  if (!db.prepare("UPDATE stations SET key_hash=? WHERE id=?").run(D.sha256(key), id).changes) throw new HttpError(404, "Tapılmadı");
  res.json({ id, key });
}));
app.post("/api/admin/stations/:id/collect", need("admin"), route((req, res) => {
  const id = int(req.params.id, "Məntəqə", 1, 1e9);
  const rates = D.getSettings().rates;
  const mats = req.body.material === "all" || !req.body.material ? MATERIALS : [material(req.body.material)];
  const out = db.transaction(() => {
    let kgT = 0, rev = 0;
    mats.forEach((m) => {
      const b = db.prepare("SELECT fill_kg FROM bins WHERE station_id=? AND material=?").get(id, m);
      if (!b || b.fill_kg <= 0) return;
      const r = +(b.fill_kg * rates[m].price).toFixed(2);
      db.prepare("INSERT INTO collections(station_id,material,kg,revenue) VALUES(?,?,?,?)").run(id, m, b.fill_kg, r);
      db.prepare("UPDATE bins SET fill_kg=0 WHERE station_id=? AND material=?").run(id, m);
      kgT += b.fill_kg; rev += r;
    });
    return { kg: +kgT.toFixed(2), revenue: +rev.toFixed(2) };
  })();
  res.json(out);
}));

app.get("/api/admin/users", need("admin"), route((req, res) => {
  const q = `%${String(req.query.q || "").slice(0, 40)}%`;
  res.json(db.prepare("SELECT u.id,u.name,u.email,u.role,u.coins,u.earned,u.is_demo,u.created_at,o.name org,u.org_id FROM users u LEFT JOIN orgs o ON o.id=u.org_id WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 100").all(q, q));
}));
app.patch("/api/admin/users/:id", need("admin"), route((req, res) => {
  const id = int(req.params.id, "İstifadəçi", 1, 1e9);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) throw new HttpError(404, "Tapılmadı");
  const role = req.body.role !== undefined ? req.body.role : u.role;
  if (!["user", "business", "admin"].includes(role)) throw bad("Rol düzgün deyil");
  if (id === req.user.id && role !== "admin") throw bad("Öz rolunuzu dəyişə bilməzsiniz");
  let orgId = u.org_id;
  if (req.body.org_id !== undefined) { orgId = req.body.org_id ? int(req.body.org_id, "Təşkilat", 1, 1e9) : null; if (orgId && !db.prepare("SELECT 1 FROM orgs WHERE id=?").get(orgId)) throw bad("Təşkilat tapılmadı"); }
  db.prepare("UPDATE users SET role=?, org_id=? WHERE id=?").run(role, orgId, id);
  res.json({ ok: true });
}));

const crud = (table, cols, label) => {
  const base = `/api/admin/${table}`;
  app.get(base, need("admin"), route((req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all())));
  app.post(base, need("admin"), route((req, res) => {
    const vals = cols.map((c) => c.read(req.body[c.name], c.label));
    const id = db.prepare(`INSERT INTO ${table}(${cols.map((c) => c.name).join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...vals).lastInsertRowid;
    res.status(201).json({ id });
  }));
  app.put(`${base}/:id`, need("admin"), route((req, res) => {
    const id = int(req.params.id, label, 1, 1e9);
    const vals = cols.map((c) => c.read(req.body[c.name], c.label));
    if (!db.prepare(`UPDATE ${table} SET ${cols.map((c) => c.name + "=?").join(",")} WHERE id=?`).run(...vals, id).changes) throw new HttpError(404, "Tapılmadı");
    res.json({ ok: true });
  }));
  app.delete(`${base}/:id`, need("admin"), route((req, res) => {
    const id = int(req.params.id, label, 1, 1e9);
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    res.json({ ok: true });
  }));
};
const C = {
  s: (name, label, min, max) => ({ name, label, read: (v) => str(v ?? "", label, min, max) }),
  i: (name, label, min, max) => ({ name, label, read: (v) => int(v, label, min, max) }),
  n: (name, label, min, max) => ({ name, label, read: (v) => num(v, label, min, max) }),
  b: (name, label) => ({ name, label, read: (v) => (v ? 1 : 0) }),
  oi: (name, label, min, max) => ({ name, label, read: (v) => (v === null || v === "" || v === undefined ? null : int(v, label, min, max)) }),
};
crud("rewards", [C.s("title", "Ad", 2, 80), C.s("description", "Təsvir", 0, 200), C.i("cost", "Qiymət", 1, 1e6), C.s("emoji", "Emoji", 1, 8), C.oi("partner_org_id", "Tərəfdaş", 1, 1e9), C.oi("stock", "Stok", 0, 1e6), C.b("active", "Aktiv")], "Mükafat");
crud("projects", [C.s("title", "Ad", 2, 80), C.s("description", "Təsvir", 0, 240), C.s("emoji", "Emoji", 1, 8), C.i("goal_coins", "Məqsəd", 10, 1e8), C.b("active", "Aktiv")], "Layihə");
crud("orgs", [C.s("name", "Ad", 2, 80), C.s("type", "Növ", 3, 20)], "Təşkilat");
crud("ads", [C.s("advertiser", "Reklamçı", 2, 60), C.s("text", "Mətn", 2, 120), C.s("emoji", "Emoji", 1, 8), C.n("monthly_price", "Qiymət", 0, 1e6), C.b("active", "Aktiv")], "Reklam");
app.get("/api/admin/settings", need("admin"), route((req, res) => res.json(D.getSettings())));
app.put("/api/admin/settings", need("admin"), route((req, res) => {
  const cur = D.getSettings();
  const next = { rates: {} };
  MATERIALS.forEach((m) => {
    const r = (req.body.rates || {})[m] || {};
    next.rates[m] = { coins: int(r.coins, "EcoCoin", 1, 1000), kg: num(r.kg, "Çəki", 0.001, 50), price: num(r.price, "Qiymət", 0, 100), co2: num(r.co2, "CO₂", 0, 100), capacity: num(r.capacity, "Tutum", 1, 100000) };
  });
  D.saveSettings(next);
  MATERIALS.forEach((m) => db.prepare("UPDATE bins SET capacity_kg=? WHERE material=?").run(next.rates[m].capacity, m));
  void cur;
  res.json({ ok: true });
}));

/* ================= static + errors ================= */
app.use("/vendor/jsQR.js", (req, res) => res.sendFile(path.join(__dirname, "node_modules/jsqr/dist/jsQR.js")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: 0 }));
app.use("/api", (req, res) => res.status(404).json({ error: "Tapılmadı" }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON düzgün deyil" });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Sorğu çox böyükdür" });
  if (err && err.code && String(err.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "Bu dəyər artıq mövcuddur və ya əlaqəli məlumat var" });
  console.error(err);
  res.status(500).json({ error: "Server xətası" });
});

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
  db.prepare("DELETE FROM qr_codes WHERE expires_at<?").run(now);
}, 600000).unref();

if (require.main === module) {
  app.listen(PORT, () => console.log(`EcoPoint tətbiqi: http://localhost:${PORT}`));
}
module.exports = app;
