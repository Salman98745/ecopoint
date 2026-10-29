import { html, mount, $, $$, get, post, api, on, toast, confetti, modal, logo, sym, fmt, esc, raw, TIPS } from "./core.js";
import { S, loadMe, loadCfg, setCoins } from "./state.js";
import { userViews } from "./user.js";
import { bizViews } from "./biz.js";
import { adminViews } from "./admin.js";

const app = $("#app");

const NAV = {
  user: [["/", "🏠", "Ana səhifə"], ["/stations", "📍", "Məntəqələr"], ["/qr", "▦", "QR"], ["/rewards", "🎁", "Mükafatlar"], ["/leaderboard", "🏆", "Reytinq"]],
  business: [["/biz", "📊", "Panel"], ["/biz/coupons", "🎟️", "Kuponlar"], ["/qr", "▦", "QR"], ["/leaderboard", "🏆", "Reytinq"]],
  admin: [["/admin", "📊", "İcmal"], ["/admin/stations", "📍", "Məntəqələr"], ["/admin/users", "👥", "İstifadəçilər"], ["/admin/rewards", "🎁", "Mükafatlar"], ["/admin/projects", "🌳", "Layihələr"], ["/admin/orgs", "🏫", "Təşkilatlar"], ["/admin/ads", "📢", "Reklam"], ["/admin/settings", "⚙️", "Parametrlər"]],
};
const DESKTOP_EXTRA = { user: [["/donate", "🌳", "Bağış"], ["/achievements", "🏅", "Nailiyyətlər"]] };
const HOME = { user: "/", business: "/biz", admin: "/admin" };

const ROUTES = {
  ...Object.fromEntries(Object.entries(userViews).map(([k, v]) => [k, { roles: ["user", "business"], ...v }])),
  ...Object.fromEntries(Object.entries(bizViews).map(([k, v]) => [k, { roles: ["business"], ...v }])),
  ...Object.fromEntries(Object.entries(adminViews).map(([k, v]) => [k, { roles: ["admin"], ...v }])),
};
// views reachable by role even if defined in another table
ROUTES["/"].roles = ["user"];
ROUTES["/qr"].roles = ["user", "business"];
ROUTES["/leaderboard"].roles = ["user", "business", "admin"];
ROUTES["/profile"].roles = ["user", "business", "admin"];

let cleanup = null;
const path = () => (location.hash.replace(/^#/, "") || "/").split("?")[0];

function layout() {
  const u = S.user, role = u.role;
  const links = NAV[role];
  const desk = [...links.filter((l) => l[0] !== "/qr" || role !== "user"), ...(DESKTOP_EXTRA[role] || [])];
  if (role === "user") desk.splice(2, 0, ["/qr", "▦", "QR kod"]);
  document.body.className = "role-" + role;
  mount(app, html`
    <header class="topbar"><div class="in">
      <a class="brand" href="#${HOME[role]}">${logo()}<span>Eco<b>Point</b></span></a>
      <nav class="nav" id="nav">${desk.map(([p, , l]) => html`<a href="#${p}" data-p="${p}">${l}</a>`)}</nav>
      <div class="row" style="margin-left:auto">
        ${role === "user" ? html`<div class="coinchip" title="EcoCoin balansı"><i>EC</i><span id="coinbal">${fmt(u.coins)}</span></div>` : ""}
        <a class="userchip" href="#/profile" title="Profil"><span class="avatar">${u.name.trim()[0].toUpperCase()}</span><span class="nm small"><b>${u.name.split(" ")[0]}</b></span></a>
      </div>
    </div></header>
    <main id="view"></main>
    ${role !== "admin" ? html`<nav class="tabbar" id="tabbar">${links.map(([p, ic, l]) => html`<a href="#${p}" data-p="${p}" class="${p === "/qr" ? "qr" : ""}"><span>${ic}</span>${l}</a>`)}</nav>` : ""}`);
}
function markNav(p) {
  $$("[data-p]").forEach((a) => a.classList.toggle("on", a.dataset.p === p));
}

async function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const p = path();
  if (!S.user) {
    if (p === "/register") return authView("register");
    return authView("login");
  }
  if (p === "/login" || p === "/register") { location.hash = "#" + HOME[S.user.role]; return; }
  let r = ROUTES[p];
  if (!r || !r.roles.includes(S.user.role)) { location.hash = "#" + HOME[S.user.role]; return; }
  if (!$("#view")) layout();
  markNav(p);
  const view = $("#view");
  window.scrollTo(0, 0);
  mount(view, html`<div class="center muted" style="padding:80px 0">Yüklənir…</div>`);
  try {
    await loadCfg();
    const out = await r.render(view);
    if (typeof out === "function") cleanup = out;
    view.classList.remove("view"); void view.offsetWidth; view.classList.add("view");
  } catch (e) {
    if (e.status === 401) { S.user = null; return render(); }
    mount(view, html`<div class="card center"><h3>Xəta</h3><p>${e.message}</p><button class="btn mt" data-act="reload">Yenidən yoxla</button></div>`);
  }
}
on("reload", () => render());

/* ---------------- auth ---------------- */
async function authView(mode) {
  document.body.className = "";
  const [orgs, st] = await Promise.all([get("/api/orgs"), get("/api/public/stats")]);
  const isReg = mode === "register";
  mount(app, html`
  <div class="authwrap">
    <div class="authside">
      <div class="row" style="gap:12px">${logo(46)}<b style="font-size:1.5rem">Eco<span style="color:var(--gold)">Point</span></b></div>
      <div>
        <div class="bob" style="width:200px;margin-bottom:10px">${sym("tosbik-wave", "", 200)}</div>
        <h1>Tullantını dəyərə çevir. ♻️</h1>
        <p>Plastik, kağız, şüşə və metalı çeşidlə, EcoCoin qazan, mükafata çevir — və ya yaxşılığa bağışla.</p>
        <div class="stats3"><div><b>${fmt(st.users)}</b><span>istifadəçi</span></div><div><b>${fmt(st.kg)}</b><span>kq təkrar emal</span></div><div><b>${fmt(st.stations)}</b><span>məntəqə</span></div></div>
      </div>
      <div class="small hide-m" style="color:rgba(255,255,255,.55)">EcoPoint — Smart Recycling Ecosystem · Gəncə pilotu</div>
    </div>
    <div class="authform"><div class="box">
      <h2>${isReg ? "Qeydiyyat" : "Xoş gəldin!"}</h2>
      <p class="mb">${isReg ? "Hesab yarat və ilk EcoCoin-lərini qazan." : "Hesabına daxil ol."}</p>
      <div id="autherr"></div>
      <form data-form="${isReg ? "register" : "login"}" autocomplete="on">
        ${isReg ? html`<div class="field"><label for="name">Ad və soyad</label><input id="name" name="name" type="text" required minlength="2" maxlength="60" autocomplete="name"></div>` : ""}
        <div class="field"><label for="email">E-poçt</label><input id="email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="password">Parol</label><input id="password" name="password" type="password" required ${isReg ? 'minlength="8"' : ""} maxlength="100" autocomplete="${isReg ? "new-password" : "current-password"}"></div>
        ${isReg ? html`<div class="field"><label for="org">Universitet / təşkilat (könüllü)</label><select id="org" name="org_id"><option value="">— seçmirəm —</option>${orgs.filter((o) => o.type !== "partner").map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select><div class="tiny muted" style="margin-top:6px">EcoUniversity Challenge-də komandana xal qazandırır.</div></div>` : ""}
        <button class="btn block lg" type="submit">${isReg ? "Qeydiyyatdan keç" : "Daxil ol"}</button>
      </form>
      <p class="small center mt">${isReg ? html`Artıq hesabın var? <a href="#/login"><b>Daxil ol</b></a>` : html`Hesabın yoxdur? <a href="#/register"><b>Qeydiyyatdan keç</b></a>`}</p>
      ${!isReg ? html`<div class="mt"><div class="tiny muted">Demo hesablar (parol: <b>demo1234</b>):</div><div class="demo"><button data-act="fill" data-e="demo@ecopoint.az">👤 İstifadəçi</button><button data-act="fill" data-e="gdu@ecopoint.az">🏫 Universitet</button><button data-act="fill" data-e="kafe@ecopoint.az">☕ Tərəfdaş</button>${window.EP_DEMO ? html`<button data-act="fill" data-e="admin@ecopoint.az">👑 Admin</button>` : ""}</div></div>` : ""}
      <p class="tiny muted center mt">Stansiya ekranı: <a href="kiosk.html">Kiosk rejimi</a></p>
    </div></div>
  </div>`);
}
on("fill", (el) => { $("#email").value = el.dataset.e; $("#password").value = "demo1234"; });
async function authSubmit(url, data, f) {
  const box = $("#autherr"); box.innerHTML = "";
  const btn = $("button[type=submit]", f); btn.disabled = true;
  try {
    const body = { ...data }; if (!body.org_id) delete body.org_id;
    const r = await post(url, body);
    S.user = r.user; connectEvents();
    location.hash = "#" + HOME[S.user.role];
    render();
  } catch (e) { mount(box, html`<div class="err">${e.message}</div>`); btn.disabled = false; }
}
on("login", (f, d) => authSubmit("/api/auth/login", d, f));
on("register", (f, d) => authSubmit("/api/auth/register", d, f));
on("logout", async () => {
  await post("/api/auth/logout"); S.user = null; if (S.es) { S.es.close(); S.es = null; }
  document.body.className = ""; location.hash = "#/login"; render();
});

/* ---------------- live events (SSE) ---------------- */
function connectEvents() {
  if (S.es) S.es.close();
  const es = new EventSource("/api/events");
  S.es = es;
  es.addEventListener("connected", (e) => { const d = JSON.parse(e.data); toast("📍 " + d.station + " məntəqəsinə qoşuldun!", "gold"); document.dispatchEvent(new CustomEvent("ep:connected", { detail: d })); });
  es.addEventListener("deposit", (e) => {
    const d = JSON.parse(e.data);
    setCoins(d.balance);
    if (path() !== "/qr") celebrate(d);
    document.dispatchEvent(new CustomEvent("ep:deposit", { detail: d }));
  });
  es.addEventListener("achievement", (e) => { const a = JSON.parse(e.data); toast(`${a.emoji} Yeni nailiyyət: ${a.title}`, "gold"); confetti(18); });
  es.addEventListener("finished", (e) => document.dispatchEvent(new CustomEvent("ep:finished", { detail: JSON.parse(e.data) })));
}
function celebrate(d) {
  confetti(26);
  const m = modal(html`<div class="center"><div style="width:130px;margin:0 auto" class="bob">${sym("tosbik-happy", "", 130)}</div><h2 class="mt">+${d.total} EcoCoin!</h2><p>Təşəkkürlər! Planet üçün bir addım daha. 🌍</p>${d.levelUp ? html`<p class="mt"><span class="chip gold">🎉 Yeni səviyyə: ${d.level.emoji} ${d.level.name}</span></p>` : ""}<button class="btn mt" data-close>Əla!</button></div>`);
  setTimeout(() => m.close(), 5000);
}

/* ---------------- boot ---------------- */
window.addEventListener("hashchange", render);
(async () => {
  try { await loadMe(); } catch { /* offline */ }
  if (S.user) connectEvents();
  render();
})();
