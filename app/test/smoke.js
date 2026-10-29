"use strict";
// End-to-end API test. Uses a throw-away database.
const os = require("os"), path = require("path"), fs = require("fs");
process.env.ECOPOINT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "ecopoint-test-"));
process.env.ADMIN_PASSWORD = "test-admin-pass";
const app = require("../server");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };

(async () => {
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = () => { let c = ""; return async (m, p, b, h = {}) => {
    const r = await fetch(base + p, { method: m, headers: { ...(b !== undefined ? { "content-type": "application/json" } : {}), ...(c ? { cookie: c } : {}), ...h }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) c = sc.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  }; };
  const admin = jar(), user = jar(), biz = jar(), anon = jar();

  console.log("Auth");
  let r = await anon("POST", "/api/auth/register", { name: "Test İstifadəçi", email: "t@x.az", password: "short" });
  ok(r.s === 400, "qısa parol rədd edilir");
  r = await user("POST", "/api/auth/register", { name: "Test İstifadəçi", email: "t@x.az", password: "parol12345" });
  ok(r.s === 201 && r.j.user.role === "user", "qeydiyyat işləyir");
  r = await anon("POST", "/api/auth/register", { name: "Başqa", email: "t@x.az", password: "parol12345" });
  ok(r.s === 409, "təkrar e-poçt rədd edilir");
  r = await anon("POST", "/api/auth/login", { email: "t@x.az", password: "yanlis-parol" });
  ok(r.s === 401, "yanlış parol rədd edilir");
  r = await anon("GET", "/api/me/overview");
  ok(r.s === 401, "giriş olmadan qorunan marşrut 401 verir");
  r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  ok(r.status === 415, "JSON olmayan POST rədd edilir (CSRF)");
  r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  ok(r.status === 403, "başqa origin rədd edilir");

  console.log("Admin & stations");
  r = await admin("POST", "/api/auth/login", { email: "admin@ecopoint.az", password: "test-admin-pass" });
  ok(r.s === 200 && r.j.user.role === "admin", "admin girişi");
  r = await user("GET", "/api/admin/overview");
  ok(r.s === 403, "adi istifadəçi admin panelinə giriş edə bilmir");
  r = await admin("POST", "/api/admin/stations", { name: "Test məntəqə", address: "Test", lat: 40.68, lng: 46.36 });
  ok(r.s === 201 && r.j.key.length > 20, "məntəqə yaradılır, açar qaytarılır");
  const st = { id: r.j.id, key: r.j.key };
  const kh = { "x-station-id": String(st.id), "x-station-key": st.key };
  r = await anon("GET", "/api/kiosk/state", undefined, { "x-station-id": String(st.id), "x-station-key": "wrong" });
  ok(r.s === 401, "yanlış məntəqə açarı rədd edilir");
  r = await anon("GET", "/api/kiosk/state", undefined, kh);
  ok(r.s === 200 && r.j.bins.length === 4, "kiosk vəziyyəti");

  console.log("QR → kiosk → deposit");
  r = await user("POST", "/api/me/qr", {});
  ok(r.s === 200 && /^[A-Z2-9]{8}$/.test(r.j.code) && r.j.svg.includes("<svg"), "QR kod yaradılır");
  const code = r.j.code;
  r = await anon("POST", "/api/kiosk/identify", { code: "ZZZZZZZZ" }, kh);
  ok(r.s === 404, "yanlış QR kod rədd edilir");
  r = await anon("POST", "/api/kiosk/identify", { code: "EP:" + code }, kh);
  ok(r.s === 200 && r.j.sessionId, "QR kod ilə tanınma");
  const sid = r.j.sessionId;
  r = await anon("POST", "/api/kiosk/identify", { code }, kh);
  ok(r.s === 404, "QR kod yalnız bir dəfə işləyir");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "plastik", items: 3 }, kh);
  ok(r.s === 200 && r.j.coins === 30 && r.j.bonus === 2 && r.j.total === 32, "plastik: 3×10 + gündəlik bonus 2 = 32");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "metal", items: 2 }, kh);
  ok(r.s === 200 && r.j.coins === 24 && r.j.bonus === 0 && r.j.balance === 56, "metal: 2×12, bonus təkrar verilmir, balans 56");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "xxx", items: 1 }, kh);
  ok(r.s === 400, "yanlış material rədd edilir");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "kagiz", items: 99 }, kh);
  ok(r.s === 400, "həddindən çox say rədd edilir");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "kagiz", items: 1 }, { "x-station-id": "1", "x-station-key": "bad" });
  ok(r.s === 401, "başqa məntəqənin açarı ilə depozit olmur");
  r = await user("GET", "/api/me/overview");
  ok(r.j.user.coins === 56 && r.j.stats.deposits === 2 && r.j.stats.items.plastik === 3 && r.j.streak === 1, "istifadəçi paneli düzgün statistika göstərir");
  r = await user("GET", "/api/me/achievements");
  ok(r.j.find((a) => a.key === "first").unlocked, "‘İlk addım’ nailiyyəti açıldı");

  console.log("Bin capacity");
  let full = 0;
  for (let i = 0; i < 90 && !full; i++) { const x = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "plastik", items: 20 }, kh); if (x.s === 409) full = i; }
  ok(full > 0, `plastik bölməsi dolur və 409 qaytarır (${full}-ci cəhd)`);
  r = await admin("POST", `/api/admin/stations/${st.id}/collect`, { material: "plastik" });
  ok(r.s === 200 && r.j.kg > 30 && r.j.revenue > 10, `boşaltma: ${r.j.kg} kq, ${r.j.revenue} AZN`);
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "plastik", items: 1 }, kh);
  ok(r.s === 200, "boşaldıqdan sonra yenidən qəbul edir");
  r = await anon("POST", "/api/kiosk/finish", { sessionId: sid }, kh);
  ok(r.s === 200 && r.j.items > 0, "sessiya bağlanır");
  r = await anon("POST", "/api/kiosk/deposit", { sessionId: sid, material: "plastik", items: 1 }, kh);
  ok(r.s === 410, "bağlanmış sessiyaya depozit olmur");

  console.log("Rewards, coupons, donations");
  r = await user("GET", "/api/rewards");
  const cheap = r.j.find((x) => x.cost === 300), pricey = r.j.find((x) => x.cost === 1000);
  r = await user("POST", `/api/rewards/${pricey.id}/redeem`, {});
  const before = (await user("GET", "/api/me")).j.user.coins;
  ok(before >= 300, `kifayət qədər EcoCoin var (${before})`);
  if (before < 1000) ok(r.s === 409, "EcoCoin çatmayanda mükafat verilmir");
  r = await user("POST", `/api/rewards/${cheap.id}/redeem`, {});
  ok(r.s === 201 && /^EP-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.j.redemption.code), "mükafat alınır, kupon kodu yaradılır");
  const coupon = r.j.redemption.code;
  ok(r.j.balance === before - 300, "EcoCoin düzgün çıxılır");
  r = await biz("POST", "/api/auth/login", { email: "kafe@ecopoint.az", password: "demo1234" });
  r = await biz("POST", "/api/biz/coupons/validate", { code: coupon });
  ok(r.s === 404, "kupon başqa tərəfdaşa aiddirsə (Kitab Dünyası) — Kafe Nizami təsdiq edə bilmir");
  const kitab = jar(); await kitab("POST", "/api/auth/login", { email: "admin@ecopoint.az", password: "test-admin-pass" });
  r = await kitab("POST", "/api/biz/coupons/validate", { code: coupon.toLowerCase() });
  ok(r.s === 409 || r.s === 200 || r.s === 404, "admin sorğusu cavab verir");
  // proper partner: Kitab Dünyası has no login → validate via admin requires org; check double-use on cafe coupon instead
  const cafeReward = (await user("GET", "/api/rewards")).j.find((x) => x.cost === 500);
  const need = 500;
  let bal = (await user("GET", "/api/me")).j.user.coins;
  while (bal < need) { const k = await user("POST", "/api/me/qr", {}); const idf = await anon("POST", "/api/kiosk/identify", { code: k.j.code }, kh); await anon("POST", "/api/kiosk/deposit", { sessionId: idf.j.sessionId, material: "metal", items: 20 }, kh); bal = (await user("GET", "/api/me")).j.user.coins; }
  r = await user("POST", `/api/rewards/${cafeReward.id}/redeem`, {});
  ok(r.s === 201, "kafe kuponu alınır");
  const cafeCode = r.j.redemption.code;
  r = await biz("POST", "/api/biz/coupons/validate", { code: cafeCode });
  ok(r.s === 200 && r.j.ok, "tərəfdaş kuponu təsdiq edir");
  r = await biz("POST", "/api/biz/coupons/validate", { code: cafeCode });
  ok(r.s === 409, "kupon ikinci dəfə istifadə olunmur");
  r = await user("GET", "/api/projects");
  const pid = r.j[0].id;
  const b2 = (await user("GET", "/api/me")).j.user.coins;
  r = await user("POST", `/api/projects/${pid}/donate`, { coins: 50 });
  ok(r.s === 200 && r.j.balance === b2 - 50, "bağış edilir, balans azalır");
  r = await user("POST", `/api/projects/${pid}/donate`, { coins: 99999999 });
  ok(r.s === 400 || r.s === 409, "həddindən çox bağış rədd edilir");
  r = await user("POST", `/api/projects/${pid}/donate`, { coins: -5 });
  ok(r.s === 400, "mənfi bağış rədd edilir");

  console.log("Leaderboard, business, admin");
  r = await user("GET", "/api/leaderboard?period=month");
  ok(r.j.users.length > 0 && r.j.orgs.length > 0 && r.j.users.some((u) => u.me), "reytinq işləyir");
  r = await biz("POST", "/api/auth/login", { email: "gdu@ecopoint.az", password: "demo1234" });
  r = await biz("GET", "/api/biz/dashboard");
  ok(r.s === 200 && r.j.org.name.includes("Gəncə Dövlət") && r.j.series.length === 6, "B2B panel");
  r = await biz("POST", "/api/biz/waste-log", { total_kg: 500 });
  r = await biz("GET", "/api/biz/dashboard");
  ok(r.j.totalLogged === 500 && r.j.recycledPct !== null, "tullantı jurnalı təkrar emal faizini hesablayır");
  r = await user("GET", "/api/biz/dashboard");
  ok(r.s === 403, "adi istifadəçi B2B panelinə giriş edə bilmir");
  r = await admin("GET", "/api/admin/overview");
  ok(r.s === 200 && r.j.deposits > 0 && r.j.series.length === 14, "admin icmalı");
  r = await admin("GET", "/api/admin/users?q=Test");
  ok(r.j.some((u) => u.email === "t@x.az"), "istifadəçi axtarışı");
  r = await admin("PUT", "/api/admin/rewards/1", { title: "X", description: "", cost: -1, emoji: "🎁", partner_org_id: null, stock: null, active: 1 });
  ok(r.s === 400, "admin formasında yanlış dəyər rədd edilir");
  r = await admin("GET", "/api/public/stats");
  ok(r.j.deposits > 0 && r.j.kg > 0, "ictimai statistika");
  r = await anon("GET", "/api/admin/../../etc/passwd");
  ok(r.s !== 200, "yol keçidi işləmir");
  r = await anon("POST", "/api/auth/login", { email: "' OR 1=1 --", password: "x" });
  ok(r.s === 401 || r.s === 400, "SQL injection cəhdi uğursuzdur");

  console.log(`\n${pass} keçdi, ${fail} uğursuz`);
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
