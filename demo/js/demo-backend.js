/* EcoPoint — serversiz demo backend.
 * Server (server.js) ilə eyni API və qaydalar; məlumatlar brauzerin localStorage-ində saxlanılır.
 * Brauzerdə fetch / EventSource-u əvəz edir; Node-da test üçün handle() ixrac olunur. */
(function (root) {
  "use strict";
  const MATERIALS = ["plastik", "kagiz", "shushe", "metal"];
  const LABEL = { plastik: "Plastik", kagiz: "Kağız", shushe: "Şüşə", metal: "Metal" };
  const DEFAULT_RATES = {
    plastik: { coins: 10, kg: 0.025, price: 0.45, co2: 1.5, capacity: 40 },
    kagiz: { coins: 6, kg: 0.1, price: 0.12, co2: 0.9, capacity: 80 },
    shushe: { coins: 8, kg: 0.35, price: 0.06, co2: 0.3, capacity: 120 },
    metal: { coins: 12, kg: 0.03, price: 0.8, co2: 4.0, capacity: 60 },
  };
  const LEVELS = [
    { min: 0, name: "Yeni başlayan", emoji: "🌱" }, { min: 100, name: "Çeşidləyən", emoji: "♻️" }, { min: 400, name: "Eko-dost", emoji: "🐢" },
    { min: 1000, name: "Eko-qəhrəman", emoji: "🦸" }, { min: 2500, name: "Planet qoruyucusu", emoji: "🌍" }, { min: 5000, name: "Eko-lider", emoji: "👑" },
  ];
  const ACH = [
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
  const DB_KEY = "ecopoint.demo.db.v1";
  const QR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const AZ = 4 * 3600 * 1000;

  class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
  const bad = (m) => new HttpError(400, m);

  /* ---------- env (storage, events, crypto) ---------- */
  const env = { storage: null, session: null, emit: () => {}, qr: async () => "<svg xmlns='http://www.w3.org/2000/svg'/>" };
  const rnd = (n) => { const a = new Uint32Array(1); (root.crypto || require("crypto").webcrypto).getRandomValues(a); return a[0] % n; };
  const randStr = (alpha, n) => Array.from({ length: n }, () => alpha[rnd(alpha.length)]).join("");
  const hex = (n) => randStr("0123456789abcdef", n);
  async function sha(s) {
    const buf = await (root.crypto || require("crypto").webcrypto).subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const hashPw = (pw) => sha("ep-demo:" + pw);

  /* ---------- time ---------- */
  const sqlTime = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 19).replace("T", " ");
  const dayStr = (ts = Date.now()) => new Date(ts + AZ).toISOString().slice(0, 10);
  const monthStr = (ts = Date.now()) => new Date(ts + AZ).toISOString().slice(0, 7);
  function monthRange(m) { const [y, mo] = m.split("-").map(Number); return [sqlTime(Date.UTC(y, mo - 1, 1) - AZ), sqlTime(Date.UTC(y, mo, 1) - AZ)]; }
  const inRange = (t, [a, b]) => t >= a && t < b;

  /* ---------- db ---------- */
  const T = ["orgs", "users", "stations", "bins", "deposits", "qr", "ksess", "rewards", "redemptions", "projects", "donations", "ach", "wastelogs", "collections", "ads"];
  function load() { const raw = env.storage.getItem(DB_KEY); if (raw) return JSON.parse(raw); const db = seed(); save(db); return db; }
  function save(db) { env.storage.setItem(DB_KEY, JSON.stringify(db)); }
  const nid = (db, t) => (db.seq[t] = (db.seq[t] || 0) + 1);
  const ins = (db, t, row) => { row.id = nid(db, t); db[t].push(row); return row; };
  const find = (db, t, f) => db[t].find(f);

  function seed() {
    const db = { seq: {}, settings: { rates: JSON.parse(JSON.stringify(DEFAULT_RATES)) } };
    T.forEach((t) => (db[t] = []));
    const org = (name, type) => ins(db, "orgs", { name, type, city: "Gəncə" }).id;
    const GDU = org("Gəncə Dövlət Universiteti", "university"), ATU = org("Azərbaycan Texnologiya Universiteti", "university"), GAU = org("Gəncə Aqrar Universiteti", "university");
    const KAF = org("Kafe Nizami", "partner"), KIT = org("Kitab Dünyası", "partner"), MAR = org("Market+", "partner");
    const user = (name, email, role, org_id, demo, pw) => ins(db, "users", { name, email, pass_hash: pw, role, org_id, coins: 0, earned: 0, xp: 0, streak: 0, last_deposit_day: null, is_demo: demo, created_at: sqlTime() });
    const PW = "ep-demo-pw-placeholder";
    db.__pendingUsers = [["Administrator", "admin@ecopoint.az", "admin", null], ["Demo İstifadəçi", "demo@ecopoint.az", "user", GDU], ["GDU Təşkilat Meneceri", "gdu@ecopoint.az", "business", GDU], ["Kafe Nizami", "kafe@ecopoint.az", "business", KAF]];
    db.__ids = { GDU, ATU, GAU, KAF, KIT, MAR };
    void user; void PW;
    return db;
  }
  // second-phase seeding (needs async hashing)
  async function finishSeed(db) {
    if (!db.__pendingUsers) return db;
    const { GDU, ATU, GAU, KAF, KIT, MAR } = db.__ids;
    const pw = await hashPw("demo1234");
    const user = (name, email, role, org_id, demo, pwh) => ins(db, "users", { name, email, pass_hash: pwh || pw, role, org_id, coins: 0, earned: 0, xp: 0, streak: 0, last_deposit_day: null, is_demo: demo, created_at: sqlTime() });
    const demoUserId = {};
    db.__pendingUsers.forEach(([n, e, r, o]) => { demoUserId[e] = user(n, e, r, o, 0).id; });
    const rates = db.settings.rates;
    const stationIds = [];
    [["EcoPoint #1 — Universitet", "Gəncə Dövlət Universiteti, mərkəzi korpus", 40.6828, 46.3606], ["EcoPoint #2 — Park", "Şəhər parkı, giriş meydançası", 40.6805, 46.3545], ["EcoPoint #3 — Mərkəz", "Şəhər mərkəzi, ticarət məntəqəsi", 40.6859, 46.3662]].forEach(([name, address, lat, lng]) => {
      const s = ins(db, "stations", { name, address, lat, lng, key: "demo", active: 1, created_at: sqlTime() });
      stationIds.push(s.id);
      MATERIALS.forEach((m) => db.bins.push({ station_id: s.id, material: m, fill_kg: 0, capacity_kg: rates[m].capacity }));
    });
    [["5 AZN endirim", "Kafe Nizami-də 5 AZN endirim kuponu", 500, "☕", KAF], ["Pulsuz içki", "Kafe Nizami-də istənilən içki", 750, "🥤", KAF], ["Kitab endirimi 10%", "Kitab Dünyası mağazasında 10% endirim", 300, "📚", KIT], ["Market kuponu", "Market+ üçün 10 AZN alış-veriş kuponu", 1000, "🛒", MAR]]
      .forEach(([title, description, cost, emoji, partner_org_id]) => ins(db, "rewards", { title, description, cost, emoji, partner_org_id, stock: null, active: 1 }));
    [["Ağacəkmə aksiyası", "Hər 100 EcoCoin ilə şəhər parklarında yeni ağac əkilir.", "🌳", 5000], ["Yaşıllaşdırma", "Məktəb həyətlərinin və yaşıl zonaların abadlaşdırılması.", "🌱", 4000], ["Su hövzələrinin təmizlənməsi", "Çay və göl sahillərinin tullantılardan təmizlənməsi.", "🌊", 6000]]
      .forEach(([title, description, emoji, goal_coins]) => ins(db, "projects", { title, description, emoji, goal_coins, raised_coins: 0, active: 1 }));
    ins(db, "ads", { advertiser: "Kafe Nizami", text: "EcoCoin ilə pulsuz içki — Kafe Nizami", emoji: "☕", monthly_price: 100, active: 1 });
    ins(db, "ads", { advertiser: "Kitab Dünyası", text: "Kitab Dünyası: EcoCoin sahiblərinə 10% endirim", emoji: "📚", monthly_price: 100, active: 1 });

    let seedN = 7; const r = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
    const deposit = (uid, sid, mat, items, ts) => {
      const c = items * rates[mat].coins, u = db.users.find((x) => x.id === uid);
      ins(db, "deposits", { user_id: uid, station_id: sid, material: mat, items, weight_kg: +(items * rates[mat].kg).toFixed(3), coins: c, bonus: 0, created_at: sqlTime(ts) });
      db.bins.find((b) => b.station_id === sid && b.material === mat).fill_kg += items * rates[mat].kg;
      u.coins += c; u.earned += c; u.xp += c;
    };
    [["Aysel Məmmədova", GDU], ["Rauf Əliyev", GDU], ["Nigar Həsənova", ATU], ["Elvin Quliyev", ATU], ["Leyla Hüseynova", GAU], ["Tural Babayev", GAU], ["Səbinə Rzayeva", GDU], ["Orxan Nəbiyev", ATU]].forEach(([nm, oid], i) => {
      const u = user(nm, `demo${i + 1}@demo.ecopoint.az`, "user", oid, 1, "x");
      const act = 0.35 + r() * 0.6;
      for (let d = 29; d >= 0; d--) {
        if (r() > act) continue;
        const ts = Date.now() - d * 86400000 - Math.floor(r() * 8) * 3600000;
        const k = 1 + Math.floor(r() * 2);
        for (let j = 0; j < k; j++) deposit(u.id, stationIds[Math.floor(r() * 3)], MATERIALS[Math.floor(r() * 4)], 1 + Math.floor(r() * 9), ts);
      }
      u.streak = 1 + Math.floor(r() * 5); u.last_deposit_day = dayStr();
    });
    const du = db.users.find((x) => x.id === demoUserId["demo@ecopoint.az"]);
    [["plastik", 5], ["kagiz", 3], ["shushe", 2]].forEach(([m, n], i) => deposit(du.id, stationIds[0], m, n, Date.now() - 2 * 86400000 + i * 3600000));
    du.streak = 1; du.last_deposit_day = dayStr(Date.now() - 2 * 86400000);
    delete db.__pendingUsers; delete db.__ids;
    return db;
  }

  /* ---------- validation ---------- */
  function str(v, name, min, max) { if (typeof v !== "string") throw bad(`${name} düzgün deyil`); const s = v.trim(); if (s.length < min || s.length > max) throw bad(`${name} ${min}–${max} simvol olmalıdır`); return s; }
  function int(v, name, min, max) { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} ${min}–${max} aralığında tam ədəd olmalıdır`); return n; }
  function num(v, name, min, max) { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw bad(`${name} ${min}–${max} aralığında olmalıdır`); return n; }
  const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
  const material = (m) => { if (!MATERIALS.includes(m)) throw bad("Material növü düzgün deyil"); return m; };
  const shortName = (n) => { const p = String(n).split(" "); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };

  /* ---------- game rules ---------- */
  function levelFor(xp) {
    let i = 0; LEVELS.forEach((l, k) => { if (xp >= l.min) i = k; });
    const cur = LEVELS[i], nxt = LEVELS[i + 1] || null;
    return { level: i + 1, name: cur.name, emoji: cur.emoji, xp, next: nxt ? nxt.min : null, progress: nxt ? Math.min(1, (xp - cur.min) / (nxt.min - cur.min)) : 1 };
  }
  function userStats(db, uid) {
    const u = db.users.find((x) => x.id === uid);
    const items = {}, kgBy = {}; MATERIALS.forEach((m) => { items[m] = 0; kgBy[m] = 0; });
    let deposits = 0, kg = 0;
    db.deposits.filter((d) => d.user_id === uid).forEach((d) => { items[d.material] += d.items; kgBy[d.material] += d.weight_kg; kg += d.weight_kg; deposits++; });
    return { coins: u.coins, earned: u.earned, xp: u.xp, streak: u.streak, items, kgBy, kg, deposits, donations: db.donations.filter((d) => d.user_id === uid).length, redemptions: db.redemptions.filter((d) => d.user_id === uid).length };
  }
  function impactOf(db, kgBy) { const rt = db.settings.rates; let co2 = 0; MATERIALS.forEach((m) => (co2 += (kgBy[m] || 0) * rt[m].co2)); return { co2: +co2.toFixed(2), trees: +((kgBy.kagiz || 0) * 0.017).toFixed(2) }; }
  function checkAch(db, uid) {
    const s = userStats(db, uid), fresh = [];
    ACH.forEach((a) => { if (!db.ach.some((x) => x.user_id === uid && x.key === a.key) && a.test(s)) { db.ach.push({ user_id: uid, key: a.key, unlocked_at: sqlTime() }); fresh.push({ key: a.key, emoji: a.emoji, title: a.title }); } });
    return fresh;
  }
  function publicUser(db, u) {
    const o = u.org_id ? db.orgs.find((x) => x.id === u.org_id) : null;
    return { id: u.id, name: u.name, email: u.email, role: u.role, org: o ? { id: o.id, name: o.name, type: o.type } : null, coins: u.coins, earned: u.earned, streak: u.streak, level: levelFor(u.xp) };
  }
  const binsOf = (db, sid) => MATERIALS.map((m) => db.bins.find((b) => b.station_id === sid && b.material === m)).filter(Boolean).map((b) => ({ material: b.material, fill_kg: +b.fill_kg.toFixed(2), capacity_kg: b.capacity_kg, pct: Math.min(100, Math.round((b.fill_kg / b.capacity_kg) * 100)), full: b.fill_kg >= b.capacity_kg - 0.001 }));
  const depView = (db, d) => ({ id: d.id, material: d.material, items: d.items, weight_kg: d.weight_kg, coins: d.coins, bonus: d.bonus, created_at: d.created_at, station: (db.stations.find((s) => s.id === d.station_id) || {}).name });
  const couponCode = () => { const c = randStr(QR_ALPHABET, 8); return `EP-${c.slice(0, 4)}-${c.slice(4)}`; };
  const lastN = (arr, n) => arr.slice().reverse().slice(0, n);

  /* ---------- routes ---------- */
  const routes = [];
  const R = (method, pattern, roles, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), roles, fn });

  R("GET", "health", null, () => ({ ok: true }));
  R("GET", "public/stats", null, ({ db }) => ({ users: db.users.filter((u) => u.role === "user").length, deposits: db.deposits.length, kg: +db.deposits.reduce((a, d) => a + d.weight_kg, 0).toFixed(1), items: db.deposits.reduce((a, d) => a + d.items, 0), stations: db.stations.filter((s) => s.active).length }));
  R("GET", "orgs", null, ({ db }) => db.orgs.slice().sort((a, b) => (a.type < b.type ? 1 : a.type > b.type ? -1 : a.name.localeCompare(b.name))).map(({ id, name, type }) => ({ id, name, type })));
  R("GET", "config", null, ({ db }) => ({ rates: db.settings.rates, levels: LEVELS, achievements: ACH.map(({ test, ...a }) => a), labels: LABEL }));

  /* auth */
  R("POST", "auth/register", null, async ({ db, body, res }) => {
    const name = str(body.name, "Ad", 2, 60), email = str(body.email, "E-poçt", 5, 254).toLowerCase(), password = str(body.password, "Parol", 8, 100);
    if (!emailOk(email)) throw bad("E-poçt düzgün deyil");
    let orgId = null;
    if (body.org_id) { orgId = int(body.org_id, "Təşkilat", 1, 1e9); if (!find(db, "orgs", (o) => o.id === orgId && o.type !== "partner")) throw bad("Təşkilat tapılmadı"); }
    if (find(db, "users", (u) => u.email === email)) throw new HttpError(409, "Bu e-poçt artıq qeydiyyatdan keçib");
    const u = ins(db, "users", { name, email, pass_hash: await hashPw(password), role: "user", org_id: orgId, coins: 0, earned: 0, xp: 0, streak: 0, last_deposit_day: null, is_demo: 0, created_at: sqlTime() });
    env.session.set(u.id); res.status = 201;
    return { user: publicUser(db, u) };
  });
  R("POST", "auth/login", null, async ({ db, body }) => {
    const email = str(body.email, "E-poçt", 3, 254).toLowerCase(), pw = str(body.password, "Parol", 1, 100);
    const u = find(db, "users", (x) => x.email === email);
    if (!u || u.pass_hash !== (await hashPw(pw))) throw new HttpError(401, "E-poçt və ya parol yanlışdır");
    env.session.set(u.id);
    return { user: publicUser(db, u) };
  });
  R("POST", "auth/logout", null, () => { env.session.clear(); return { ok: true }; });
  R("GET", "me", null, ({ db, user }) => ({ user: user ? publicUser(db, user) : null }));
  R("PATCH", "me", [], ({ db, user, body }) => {
    const name = str(body.name, "Ad", 2, 60); let orgId = user.org_id;
    if (body.org_id !== undefined && user.role === "user") { orgId = body.org_id ? int(body.org_id, "Təşkilat", 1, 1e9) : null; if (orgId && !find(db, "orgs", (o) => o.id === orgId && o.type !== "partner")) throw bad("Təşkilat tapılmadı"); }
    user.name = name; user.org_id = orgId; return { user: publicUser(db, user) };
  });
  R("POST", "me/password", [], async ({ user, body }) => {
    if (user.pass_hash !== (await hashPw(str(body.current, "Cari parol", 1, 100)))) throw new HttpError(403, "Cari parol yanlışdır");
    user.pass_hash = await hashPw(str(body.next, "Yeni parol", 8, 100)); return { ok: true };
  });

  /* user */
  R("GET", "me/overview", [], ({ db, user }) => {
    const s = userStats(db, user.id), range = monthRange(monthStr());
    const monthTotals = {}; db.deposits.filter((d) => inRange(d.created_at, range)).forEach((d) => (monthTotals[d.user_id] = (monthTotals[d.user_id] || 0) + d.coins + d.bonus));
    const monthCoins = monthTotals[user.id] || 0, rank = Object.values(monthTotals).filter((c) => c > monthCoins).length + 1;
    const today = dayStr(), alive = user.last_deposit_day === today || user.last_deposit_day === dayStr(Date.now() - 86400000);
    return { user: publicUser(db, user), stats: { items: s.items, kgBy: s.kgBy, kg: +s.kg.toFixed(2), deposits: s.deposits }, impact: impactOf(db, s.kgBy), monthCoins, rank: monthCoins > 0 ? rank : null, streak: alive ? user.streak : 0, doneToday: user.last_deposit_day === today, recent: lastN(db.deposits.filter((d) => d.user_id === user.id), 8).map((d) => depView(db, d)) };
  });
  R("GET", "me/deposits", [], ({ db, user, query }) => lastN(db.deposits.filter((d) => d.user_id === user.id), Math.min(100, Math.max(1, Number(query.limit) || 30))).map((d) => depView(db, d)));
  R("GET", "me/achievements", [], ({ db, user }) => ACH.map(({ test, ...a }) => { const h = db.ach.find((x) => x.user_id === user.id && x.key === a.key); return { ...a, unlocked: !!h, unlocked_at: h ? h.unlocked_at : null }; }));
  R("POST", "me/qr", [], async ({ db, user }) => {
    const code = randStr(QR_ALPHABET, 8), expires = Date.now() + 120000;
    db.qr = db.qr.filter((q) => q.user_id !== user.id && q.expires_at > Date.now());
    db.qr.push({ code, user_id: user.id, expires_at: expires });
    return { code, svg: await env.qr("EP:" + code), expiresAt: expires };
  });
  R("GET", "stations", null, ({ db }) => db.stations.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, active: s.active, bins: binsOf(db, s.id).map((b) => ({ material: b.material, pct: b.pct })) })));
  R("GET", "rewards", [], ({ db }) => db.rewards.filter((r) => r.active).sort((a, b) => a.cost - b.cost).map((r) => ({ id: r.id, title: r.title, description: r.description, cost: r.cost, emoji: r.emoji, stock: r.stock, partner: (db.orgs.find((o) => o.id === r.partner_org_id) || {}).name || null })));
  R("POST", "rewards/:id/redeem", [], ({ db, user, params, res }) => {
    const rid = int(params.id, "Mükafat", 1, 1e9), r = find(db, "rewards", (x) => x.id === rid && x.active);
    if (!r) throw new HttpError(404, "Mükafat tapılmadı");
    if (r.stock !== null && r.stock <= 0) throw new HttpError(409, "Mükafat bitib");
    if (user.coins < r.cost) throw new HttpError(409, "EcoCoin kifayət etmir");
    user.coins -= r.cost; if (r.stock !== null) r.stock--;
    const x = ins(db, "redemptions", { user_id: user.id, reward_id: rid, code: couponCode(), cost: r.cost, status: "active", created_at: sqlTime(), used_at: null });
    const fresh = checkAch(db, user.id); fresh.forEach((a) => env.emit(user.id, "achievement", a)); res.status = 201;
    return { redemption: { id: x.id, code: x.code, title: r.title, emoji: r.emoji, cost: r.cost }, balance: user.coins, achievements: fresh };
  });
  R("GET", "me/redemptions", [], ({ db, user }) => lastN(db.redemptions.filter((x) => x.user_id === user.id), 50).map((x) => { const r = db.rewards.find((y) => y.id === x.reward_id) || {}; return { id: x.id, code: x.code, status: x.status, cost: x.cost, created_at: x.created_at, used_at: x.used_at, title: r.title, emoji: r.emoji, partner: (db.orgs.find((o) => o.id === r.partner_org_id) || {}).name || null }; }));
  R("GET", "projects", [], ({ db }) => db.projects.filter((p) => p.active).map(({ id, title, description, emoji, goal_coins, raised_coins }) => ({ id, title, description, emoji, goal_coins, raised_coins })));
  R("POST", "projects/:id/donate", [], ({ db, user, params, body }) => {
    const pid = int(params.id, "Layihə", 1, 1e9), coins = int(body.coins, "Məbləğ", 10, 1000000), p = find(db, "projects", (x) => x.id === pid && x.active);
    if (!p) throw new HttpError(404, "Layihə tapılmadı");
    if (user.coins < coins) throw new HttpError(409, "EcoCoin kifayət etmir");
    user.coins -= coins; p.raised_coins += coins; ins(db, "donations", { user_id: user.id, project_id: pid, coins, created_at: sqlTime() });
    const fresh = checkAch(db, user.id); fresh.forEach((a) => env.emit(user.id, "achievement", a));
    return { ok: true, project: p.title, balance: user.coins, achievements: fresh };
  });
  R("GET", "leaderboard", [], ({ db, user, query }) => {
    const period = query.period === "all" ? "all" : "month", range = period === "month" ? monthRange(monthStr()) : ["1970-01-01 00:00:00", "9999-01-01 00:00:00"];
    const by = {}; db.deposits.filter((d) => inRange(d.created_at, range)).forEach((d) => { const b = (by[d.user_id] ||= { pts: 0, kg: 0 }); b.pts += d.coins + d.bonus; b.kg += d.weight_kg; });
    const users = Object.entries(by).map(([id, v]) => ({ u: db.users.find((x) => x.id === Number(id)), ...v })).sort((a, b) => b.pts - a.pts).slice(0, 20)
      .map((r, i) => ({ rank: i + 1, name: shortName(r.u.name), org: (db.orgs.find((o) => o.id === r.u.org_id) || {}).name || null, pts: r.pts, kg: +r.kg.toFixed(2), me: r.u.id === user.id, demo: !!r.u.is_demo }));
    const ob = {};
    Object.entries(by).forEach(([id, v]) => { const u = db.users.find((x) => x.id === Number(id)); const o = u.org_id && db.orgs.find((x) => x.id === u.org_id); if (!o || o.type === "partner") return; const b = (ob[o.id] ||= { o, pts: 0, kg: 0, members: 0 }); b.pts += v.pts; b.kg += v.kg; b.members++; });
    const orgs = Object.values(ob).sort((a, b) => b.pts - a.pts).slice(0, 20).map((r, i) => ({ rank: i + 1, id: r.o.id, name: r.o.name, type: r.o.type, pts: r.pts, kg: +r.kg.toFixed(2), members: r.members, mine: r.o.id === user.org_id }));
    return { period, users, orgs };
  });

  /* kiosk */
  const kioskAuth = (db, headers) => {
    const id = Number(headers["x-station-id"]), st = Number.isInteger(id) ? find(db, "stations", (s) => s.id === id && s.active) : null;
    if (!st) throw new HttpError(401, "Məntəqə doğrulanmadı");
    if ((headers["x-station-key"] || "") !== st.key) throw new HttpError(401, "Məntəqə açarı yanlışdır");
    return st;
  };
  R("GET", "kiosk/state", "kiosk", ({ db, station }) => ({ station: { id: station.id, name: station.name, address: station.address }, bins: binsOf(db, station.id), ads: db.ads.filter((a) => a.active).map(({ advertiser, text, emoji }) => ({ advertiser, text, emoji })), rates: db.settings.rates, labels: LABEL }));
  R("POST", "kiosk/identify", "kiosk", ({ db, station, body }) => {
    const code = str(body.code, "Kod", 4, 40).toUpperCase().replace(/^EP:/, "").replace(/[^A-Z0-9]/g, "");
    const row = db.qr.find((q) => q.code === code && q.expires_at > Date.now());
    if (!row) throw new HttpError(404, "Kod tapılmadı və ya vaxtı bitib");
    db.qr = db.qr.filter((q) => q.code !== code);
    const u = db.users.find((x) => x.id === row.user_id), sid = hex(24);
    db.ksess.push({ id: sid, user_id: u.id, station_id: station.id, expires_at: Date.now() + 180000, closed: 0, items_total: 0, coins_total: 0 });
    const s = userStats(db, u.id); env.emit(u.id, "connected", { station: station.name });
    return { sessionId: sid, user: { name: u.name, first: u.name.split(" ")[0], coins: u.coins, level: levelFor(u.xp), streak: u.streak }, stats: { kg: +s.kg.toFixed(2), items: s.items, impact: impactOf(db, s.kgBy) } };
  });
  R("POST", "kiosk/deposit", "kiosk", ({ db, station, body }) => {
    const sid = str(body.sessionId || "", "Sessiya", 8, 64), ks = db.ksess.find((k) => k.id === sid && k.station_id === station.id);
    if (!ks || ks.closed || ks.expires_at < Date.now()) throw new HttpError(410, "Sessiya bitib");
    const mat = material(body.material), items = int(body.items, "Say", 1, 20), rt = db.settings.rates;
    const bin = db.bins.find((b) => b.station_id === station.id && b.material === mat), weight = +(items * rt[mat].kg).toFixed(3);
    if (!bin || bin.fill_kg + weight > bin.capacity_kg + 1e-9) throw new HttpError(409, `${LABEL[mat]} bölməsi dolub`);
    const u = db.users.find((x) => x.id === ks.user_id), today = dayStr(); let streak = u.streak, bonus = 0;
    if (u.last_deposit_day !== today) { streak = u.last_deposit_day === dayStr(Date.now() - 86400000) ? u.streak + 1 : 1; bonus = Math.min(streak, 7) * 2; }
    const coins = items * rt[mat].coins, total = coins + bonus, before = levelFor(u.xp).level;
    ins(db, "deposits", { user_id: u.id, station_id: station.id, material: mat, items, weight_kg: weight, coins, bonus, created_at: sqlTime() });
    bin.fill_kg += weight; u.coins += total; u.earned += total; u.xp += total; u.streak = streak; u.last_deposit_day = today;
    ks.items_total += items; ks.coins_total += total; ks.expires_at = Date.now() + 180000;
    const fresh = checkAch(db, u.id), lvl = levelFor(u.xp);
    const payload = { material: mat, items, coins, bonus, total, balance: u.coins, streak, level: lvl, levelUp: lvl.level > before, achievements: fresh, station: station.name };
    env.emit(u.id, "deposit", payload); fresh.forEach((a) => env.emit(u.id, "achievement", a));
    return { ...payload, bins: binsOf(db, station.id), message: `Təşəkkürlər! +${total} EcoCoin qazandınız!` };
  });
  R("POST", "kiosk/finish", "kiosk", ({ db, station, body }) => {
    const ks = db.ksess.find((k) => k.id === String(body.sessionId || "") && k.station_id === station.id);
    if (ks) { ks.closed = 1; env.emit(ks.user_id, "finished", { items: ks.items_total, coins: ks.coins_total }); }
    return { ok: true, items: ks ? ks.items_total : 0, coins: ks ? ks.coins_total : 0 };
  });

  /* business */
  const bizOrg = (db, user) => { if (!user.org_id) throw new HttpError(409, "Hesab təşkilata bağlı deyil"); return db.orgs.find((o) => o.id === user.org_id); };
  R("GET", "biz/dashboard", ["business", "admin"], ({ db, user, query }) => {
    const org = bizOrg(db, user), month = /^\d{4}-\d{2}$/.test(query.month || "") ? query.month : monthStr(), range = monthRange(month);
    const members = new Set(db.users.filter((u) => u.org_id === org.id).map((u) => u.id));
    const dep = db.deposits.filter((d) => members.has(d.user_id));
    const byMat = {}; MATERIALS.forEach((m) => (byMat[m] = { items: 0, kg: 0, coins: 0 }));
    dep.filter((d) => inRange(d.created_at, range)).forEach((d) => { const b = byMat[d.material]; b.items += d.items; b.kg += d.weight_kg; b.coins += d.coins + d.bonus; });
    MATERIALS.forEach((m) => (byMat[m].kg = +byMat[m].kg.toFixed(2)));
    const sortedKg = +MATERIALS.reduce((a, m) => a + byMat[m].kg, 0).toFixed(2), log = db.wastelogs.find((w) => w.org_id === org.id && w.month === month);
    const series = [], now = new Date(Date.now() + AZ);
    for (let i = 5; i >= 0; i--) { const mm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7), rg = monthRange(mm); series.push({ month: mm, kg: +dep.filter((d) => inRange(d.created_at, rg)).reduce((a, d) => a + d.weight_kg, 0).toFixed(2) }); }
    const per = {}; dep.filter((d) => inRange(d.created_at, range)).forEach((d) => { const b = (per[d.user_id] ||= { pts: 0, kg: 0 }); b.pts += d.coins + d.bonus; b.kg += d.weight_kg; });
    const top = Object.entries(per).sort((a, b) => b[1].pts - a[1].pts).slice(0, 5).map(([id, v]) => ({ name: shortName(db.users.find((x) => x.id === Number(id)).name), pts: v.pts, kg: +v.kg.toFixed(2) }));
    const rt = db.settings.rates, co2 = +MATERIALS.reduce((a, m) => a + byMat[m].kg * rt[m].co2, 0).toFixed(1);
    return { org, month, byMat, sortedKg, totalLogged: log ? log.total_kg : null, recycledPct: log && log.total_kg > 0 ? Math.min(100, Math.round((sortedKg / log.total_kg) * 100)) : null, series, members: db.users.filter((u) => u.org_id === org.id && u.role === "user").length, top, co2 };
  });
  R("POST", "biz/waste-log", ["business", "admin"], ({ db, user, body }) => {
    const org = bizOrg(db, user), month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : monthStr(), kg = num(body.total_kg, "Ümumi tullantı", 0, 1e7);
    const w = db.wastelogs.find((x) => x.org_id === org.id && x.month === month); if (w) w.total_kg = kg; else ins(db, "wastelogs", { org_id: org.id, month, total_kg: kg });
    return { ok: true };
  });
  R("GET", "biz/coupons", ["business", "admin"], ({ db, user }) => {
    const org = bizOrg(db, user);
    return lastN(db.redemptions.filter((x) => (db.rewards.find((r) => r.id === x.reward_id) || {}).partner_org_id === org.id), 60).map((x) => { const r = db.rewards.find((y) => y.id === x.reward_id); return { id: x.id, code: x.code, status: x.status, created_at: x.created_at, used_at: x.used_at, title: r.title, emoji: r.emoji, name: shortName(db.users.find((u) => u.id === x.user_id).name) }; });
  });
  R("POST", "biz/coupons/validate", ["business", "admin"], ({ db, user, body }) => {
    const org = bizOrg(db, user), code = str(body.code, "Kupon kodu", 4, 30).toUpperCase().replace(/\s/g, ""), x = db.redemptions.find((y) => y.code === code);
    const r = x && db.rewards.find((y) => y.id === x.reward_id);
    if (!x || (r.partner_org_id !== org.id && user.role !== "admin")) throw new HttpError(404, "Kupon tapılmadı");
    if (x.status !== "active") throw new HttpError(409, "Kupon artıq istifadə olunub");
    x.status = "used"; x.used_at = sqlTime();
    return { ok: true, title: r.title, emoji: r.emoji, customer: shortName(db.users.find((u) => u.id === x.user_id).name) };
  });

  /* admin */
  R("GET", "admin/overview", ["admin"], ({ db }) => {
    const rt = db.settings.rates, kgBy = MATERIALS.map((m) => ({ material: m, kg: db.deposits.filter((d) => d.material === m).reduce((a, d) => a + d.weight_kg, 0), items: db.deposits.filter((d) => d.material === m).reduce((a, d) => a + d.items, 0) })).filter((r) => r.items);
    const series = [];
    for (let i = 13; i >= 0; i--) { const day = dayStr(Date.now() - i * 86400000), f = Date.parse(day + "T00:00:00Z") - AZ, rg = [sqlTime(f), sqlTime(f + 86400000)], list = db.deposits.filter((d) => inRange(d.created_at, rg)); series.push({ day: day.slice(5), kg: +list.reduce((a, d) => a + d.weight_kg, 0).toFixed(2), n: list.length }); }
    const bins = db.bins.filter((b) => (db.stations.find((s) => s.id === b.station_id) || {}).active);
    return {
      users: db.users.filter((u) => u.role === "user").length, deposits: db.deposits.length, kgBy, kg: +kgBy.reduce((a, r) => a + r.kg, 0).toFixed(1),
      coinsIssued: db.deposits.reduce((a, d) => a + d.coins + d.bonus, 0), coinsHeld: db.users.reduce((a, u) => a + u.coins, 0), coinsRedeemed: db.redemptions.reduce((a, x) => a + x.cost, 0), coinsDonated: db.donations.reduce((a, x) => a + x.coins, 0),
      revenue: +db.collections.reduce((a, c) => a + c.revenue, 0).toFixed(2), potential: +bins.reduce((a, b) => a + b.fill_kg * rt[b.material].price, 0).toFixed(2), adRevenue: +db.ads.filter((a) => a.active).reduce((a, x) => a + x.monthly_price, 0).toFixed(2),
      series, alerts: bins.filter((b) => b.fill_kg / b.capacity_kg >= 0.85).map((b) => ({ station: db.stations.find((s) => s.id === b.station_id).name, material: b.material, pct: Math.round((b.fill_kg / b.capacity_kg) * 100) })), redemptionsActive: db.redemptions.filter((x) => x.status === "active").length,
    };
  });
  R("GET", "admin/stations", ["admin"], ({ db }) => db.stations.map((s) => { const dep = db.deposits.filter((d) => d.station_id === s.id); return { id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, active: s.active, bins: binsOf(db, s.id).map((b) => ({ material: b.material, fill_kg: b.fill_kg, capacity_kg: b.capacity_kg, pct: b.pct })), totals: { deposits: dep.length, kg: +dep.reduce((a, d) => a + d.weight_kg, 0).toFixed(1) } }; }));
  R("POST", "admin/stations", ["admin"], ({ db, body, res }) => {
    const name = str(body.name, "Ad", 2, 80), address = str(body.address || "", "Ünvan", 0, 160);
    const lat = body.lat === "" || body.lat == null ? null : num(body.lat, "Enlik", -90, 90), lng = body.lng === "" || body.lng == null ? null : num(body.lng, "Uzunluq", -180, 180);
    const s = ins(db, "stations", { name, address, lat, lng, key: "demo", active: 1, created_at: sqlTime() });
    MATERIALS.forEach((m) => db.bins.push({ station_id: s.id, material: m, fill_kg: 0, capacity_kg: db.settings.rates[m].capacity })); res.status = 201;
    return { id: s.id, key: "demo" };
  });
  R("PATCH", "admin/stations/:id", ["admin"], ({ db, params, body }) => {
    const s = find(db, "stations", (x) => x.id === int(params.id, "Məntəqə", 1, 1e9)); if (!s) throw new HttpError(404, "Tapılmadı");
    if (body.name !== undefined) s.name = str(body.name, "Ad", 2, 80); if (body.address !== undefined) s.address = str(body.address, "Ünvan", 0, 160); if (body.active !== undefined) s.active = body.active ? 1 : 0;
    return { ok: true };
  });
  R("POST", "admin/stations/:id/key", ["admin"], ({ db, params }) => { const id = int(params.id, "Məntəqə", 1, 1e9); if (!find(db, "stations", (x) => x.id === id)) throw new HttpError(404, "Tapılmadı"); return { id, key: "demo" }; });
  R("POST", "admin/stations/:id/collect", ["admin"], ({ db, params, body }) => {
    const id = int(params.id, "Məntəqə", 1, 1e9), rt = db.settings.rates, mats = body.material === "all" || !body.material ? MATERIALS : [material(body.material)];
    let kg = 0, rev = 0;
    mats.forEach((m) => { const b = db.bins.find((x) => x.station_id === id && x.material === m); if (!b || b.fill_kg <= 0) return; const r = +(b.fill_kg * rt[m].price).toFixed(2); ins(db, "collections", { station_id: id, material: m, kg: b.fill_kg, revenue: r, created_at: sqlTime() }); kg += b.fill_kg; rev += r; b.fill_kg = 0; });
    return { kg: +kg.toFixed(2), revenue: +rev.toFixed(2) };
  });
  R("GET", "admin/users", ["admin"], ({ db, query }) => { const q = String(query.q || "").slice(0, 40).toLowerCase(); return db.users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice().reverse().slice(0, 100).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, coins: u.coins, earned: u.earned, is_demo: u.is_demo, created_at: u.created_at, org: (db.orgs.find((o) => o.id === u.org_id) || {}).name || null, org_id: u.org_id })); });
  R("PATCH", "admin/users/:id", ["admin"], ({ db, user, params, body }) => {
    const id = int(params.id, "İstifadəçi", 1, 1e9), u = find(db, "users", (x) => x.id === id); if (!u) throw new HttpError(404, "Tapılmadı");
    const role = body.role !== undefined ? body.role : u.role; if (!["user", "business", "admin"].includes(role)) throw bad("Rol düzgün deyil");
    if (id === user.id && role !== "admin") throw bad("Öz rolunuzu dəyişə bilməzsiniz");
    let orgId = u.org_id; if (body.org_id !== undefined) { orgId = body.org_id ? int(body.org_id, "Təşkilat", 1, 1e9) : null; if (orgId && !find(db, "orgs", (o) => o.id === orgId)) throw bad("Təşkilat tapılmadı"); }
    u.role = role; u.org_id = orgId; return { ok: true };
  });
  const C = {
    s: (name, label, min, max) => ({ name, read: (v) => str(v ?? "", label, min, max) }), i: (name, label, min, max) => ({ name, read: (v) => int(v, label, min, max) }),
    n: (name, label, min, max) => ({ name, read: (v) => num(v, label, min, max) }), b: (name) => ({ name, read: (v) => (v ? 1 : 0) }), oi: (name, label, min, max) => ({ name, read: (v) => (v === null || v === "" || v === undefined ? null : int(v, label, min, max)) }),
  };
  [["rewards", [C.s("title", "Ad", 2, 80), C.s("description", "Təsvir", 0, 200), C.i("cost", "Qiymət", 1, 1e6), C.s("emoji", "Emoji", 1, 8), C.oi("partner_org_id", "Tərəfdaş", 1, 1e9), C.oi("stock", "Stok", 0, 1e6), C.b("active")], { raised: 0 }],
   ["projects", [C.s("title", "Ad", 2, 80), C.s("description", "Təsvir", 0, 240), C.s("emoji", "Emoji", 1, 8), C.i("goal_coins", "Məqsəd", 10, 1e8), C.b("active")], { raised_coins: 0 }],
   ["orgs", [C.s("name", "Ad", 2, 80), C.s("type", "Növ", 3, 20)], { city: "Gəncə" }],
   ["ads", [C.s("advertiser", "Reklamçı", 2, 60), C.s("text", "Mətn", 2, 120), C.s("emoji", "Emoji", 1, 8), C.n("monthly_price", "Qiymət", 0, 1e6), C.b("active")], {}]].forEach(([t, cols, defaults]) => {
    delete defaults.raised;
    R("GET", `admin/${t}`, ["admin"], ({ db }) => db[t].slice().reverse());
    R("POST", `admin/${t}`, ["admin"], ({ db, body, res }) => { const row = { ...defaults }; cols.forEach((c) => (row[c.name] = c.read(body[c.name]))); if (t === "orgs" && db.orgs.some((o) => o.name === row.name)) throw new HttpError(409, "Bu dəyər artıq mövcuddur və ya əlaqəli məlumat var"); res.status = 201; return { id: ins(db, t, row).id }; });
    R("PUT", `admin/${t}/:id`, ["admin"], ({ db, params, body }) => { const row = find(db, t, (x) => x.id === int(params.id, "Element", 1, 1e9)); if (!row) throw new HttpError(404, "Tapılmadı"); const vals = cols.map((c) => [c.name, c.read(body[c.name])]); vals.forEach(([k, v]) => (row[k] = v)); return { ok: true }; });
    R("DELETE", `admin/${t}/:id`, ["admin"], ({ db, params }) => { const id = int(params.id, "Element", 1, 1e9); db[t] = db[t].filter((x) => x.id !== id); if (t === "orgs") db.users.forEach((u) => { if (u.org_id === id) u.org_id = null; }); if (t === "rewards") db.redemptions = db.redemptions.filter((x) => x.reward_id !== id); return { ok: true }; });
  });
  R("GET", "admin/settings", ["admin"], ({ db }) => db.settings);
  R("PUT", "admin/settings", ["admin"], ({ db, body }) => {
    const next = { rates: {} };
    MATERIALS.forEach((m) => { const r = (body.rates || {})[m] || {}; next.rates[m] = { coins: int(r.coins, "EcoCoin", 1, 1000), kg: num(r.kg, "Çəki", 0.001, 50), price: num(r.price, "Qiymət", 0, 100), co2: num(r.co2, "CO₂", 0, 100), capacity: num(r.capacity, "Tutum", 1, 100000) }; });
    db.settings = next; db.bins.forEach((b) => (b.capacity_kg = next.rates[b.material].capacity)); return { ok: true };
  });

  /* ---------- dispatcher ---------- */
  let chain = Promise.resolve();
  function handle(method, path, body, headers) { const p = chain.then(() => handle0(method, path, body, headers)); chain = p.catch(() => {}); return p; }
  async function handle0(method, path, body, headers = {}) {
    let db = load(); db = await finishSeed(db); save(db);
    const [p, qs] = path.replace(/^\/+/, "").split("?"), query = Object.fromEntries(new URLSearchParams(qs || ""));
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && body === undefined) body = {};
    const uid = env.session.get(), user = uid ? db.users.find((u) => u.id === uid) || null : null;
    const res = { status: 200 };
    try {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(p); if (!m) continue;
        let station = null;
        if (r.roles === "kiosk") station = kioskAuth(db, Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])));
        else if (Array.isArray(r.roles)) { if (!user) throw new HttpError(401, "Daxil olun"); if (r.roles.length && !r.roles.includes(user.role)) throw new HttpError(403, "İcazə yoxdur"); }
        if (body && typeof body !== "object") throw bad("JSON düzgün deyil");
        const data = await r.fn({ db, user, station, body: body || {}, params: m.groups || {}, query, res });
        if (method !== "GET") save(db);
        return { status: res.status, data };
      }
      throw new HttpError(404, "Tapılmadı");
    } catch (e) {
      if (e instanceof HttpError) { if (method !== "GET") save(db); return { status: e.status, data: { error: e.message } }; }
      console.error(e); return { status: 500, data: { error: "Server xətası" } };
    }
  }

  /* ---------- browser integration ---------- */
  function install() {
    const SS = root.sessionStorage;
    env.storage = root.localStorage;
    env.session = { get: () => { const v = SS.getItem("ecopoint.demo.uid"); return v ? Number(v) : null; }, set: (id) => SS.setItem("ecopoint.demo.uid", String(id)), clear: () => SS.removeItem("ecopoint.demo.uid") };
    if (root.qrcode) env.qr = async (text) => { const q = root.qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }).replace("<svg", '<svg shape-rendering="crispEdges"'); };
    const bc = "BroadcastChannel" in root ? new BroadcastChannel("ecopoint-demo") : null;
    env.emit = (uid, event, data) => { if (bc) bc.postMessage({ uid, event, data }); };
    const nativeFetch = root.fetch.bind(root);
    root.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url, m = /\/api\/([^?#]*)(\?[^#]*)?$/.exec(url);
      if (!m) return nativeFetch(input, init);
      let body; try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = "bad"; }
      const r = await handle((init.method || "GET").toUpperCase(), m[1] + (m[2] || ""), body, init.headers || {});
      return new Response(JSON.stringify(r.data), { status: r.status, headers: { "Content-Type": "application/json" } });
    };
    root.EventSource = class {
      constructor() { this.l = {}; this.uid = env.session.get(); this.ch = bc ? new BroadcastChannel("ecopoint-demo") : null; if (this.ch) this.ch.onmessage = (e) => { const d = e.data; if (d.uid === this.uid) (this.l[d.event] || []).forEach((f) => f({ data: JSON.stringify(d.data) })); }; }
      addEventListener(t, f) { (this.l[t] ||= []).push(f); }
      close() { if (this.ch) this.ch.close(); }
    };
    try { if (!root.localStorage.getItem("ecopoint.kiosk")) root.localStorage.setItem("ecopoint.kiosk", JSON.stringify({ id: "1", key: "demo" })); } catch { /* ignore */ }
    root.EP_DEMO = true;
    root.addEventListener("DOMContentLoaded", () => {
      const bar = document.createElement("div");
      bar.style.cssText = "position:relative;z-index:70;background:#0d3b2a;color:#fde5a6;font:600 12px/1.4 'Plus Jakarta Sans',system-ui,sans-serif;padding:6px 12px;text-align:center;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap";
      bar.innerHTML = "🧪 Demo rejimi — serversiz, məlumatlar yalnız bu brauzerdə saxlanılır. <a href='#' id='epreset' style='color:#fff;text-decoration:underline'>Sıfırla</a> · <a href='../' style='color:#fff;text-decoration:underline'>Məlumat saytı</a>";
      document.body.insertBefore(bar, document.body.firstChild);
      document.getElementById("epreset").onclick = (e) => { e.preventDefault(); if (confirm("Bütün demo məlumatları silinsin?")) { root.localStorage.removeItem(DB_KEY); root.sessionStorage.clear(); location.hash = "#/"; location.reload(); } };
    });
  }

  const api = { handle, env, install, MATERIALS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.EcoDemo = api; install(); }
})(typeof window !== "undefined" ? window : globalThis);
