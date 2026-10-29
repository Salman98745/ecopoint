import { html, raw, mount, $, $$, get, post, patch, on, toast, confetti, modal, sym, MAT, MATS, fmt, fmtDec, fmtKg, ago, dateFmt, barChart, donut, matBars, TIPS, esc } from "./core.js";
import { S, setCoins, loadMe } from "./state.js";

const levelBar = (lv) => html`<div class="row between small" style="margin-bottom:6px"><b>${lv.emoji} ${lv.name} · Səviyyə ${lv.level}</b><span class="muted">${fmt(lv.xp)}${lv.next ? " / " + fmt(lv.next) + " XP" : " XP · maksimum"}</span></div><div class="bar tall gold"><i style="width:${Math.round(lv.progress * 100)}%"></i></div>`;
const depRow = (d) => html`<div><div class="ico">${MAT[d.material].emoji}</div><div class="grow"><b>${MAT[d.material].label} × ${d.items}</b><div class="tiny muted">${d.station} · ${ago(d.created_at)}</div></div><div class="right"><b class="gold">+${d.coins + d.bonus}</b><div class="tiny muted">${d.bonus ? "bonus +" + d.bonus : fmtKg(d.weight_kg)}</div></div></div>`;

/* =============== HOME =============== */
async function home(el) {
  const o = await get("/api/me/overview");
  setCoins(o.user.coins);
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const lv = o.user.level;
  mount(el, html`
  <div class="hero">
    <div class="card dark">
      <div class="row between wrap"><div><div class="small" style="opacity:.8">Salam, ${o.user.name.split(" ")[0]}! 👋</div><div class="balance mt" style="margin-top:8px">${fmt(o.user.coins)}</div><div style="opacity:.8;font-weight:700">EcoCoin balansı</div></div>
        <div class="bob" style="margin-left:auto">${sym("tosbik-wave", "", 120)}</div></div>
      <div class="mt">${levelBar(lv)}</div>
      <div class="row wrap mt">
        <a class="btn gold" href="#/qr">▦ QR kodumu göstər</a><a class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.5)" href="#/rewards">🎁 Mükafatlar</a>
      </div>
    </div>
    <div class="card col" style="justify-content:space-between">
      <div class="row"><div class="ico" style="background:${o.streak ? "var(--goldl)" : "var(--g50)"}">🔥</div><div><b style="font-size:1.4rem">${o.streak} günlük seriya</b><div class="small muted">${o.doneToday ? "Bu gün təhvil verdin ✓" : o.streak ? "Seriyanı davam etdirmək üçün bu gün təhvil ver!" : "Bu gün ilk təhvili et və seriyaya başla"}</div></div></div>
      <div class="row"><div class="ico">🏆</div><div><b style="font-size:1.4rem">${o.rank ? "#" + o.rank : "—"}</b><div class="small muted">Aylıq reytinqdəki yerin · ${fmt(o.monthCoins)} xal</div></div></div>
      <div class="tosbikmsg"><div style="width:62px;flex-shrink:0">${sym("tosbik-leaf", "", 62)}</div><div class="bubble small">${tip}</div></div>
    </div>
  </div>
  <div class="grid g4 keep2 mt">
    <div class="card kpi"><b>${fmtKg(o.stats.kg)}</b><span>Təhvil verilmiş tullantı</span></div>
    <div class="card kpi"><b>${fmt(Object.values(o.stats.items).reduce((a, b) => a + b, 0))}</b><span>Əşya sayı</span></div>
    <div class="card kpi"><b>${fmtDec(o.impact.co2)} kq</b><span>CO₂ qənaəti (təxmini)</span></div>
    <div class="card kpi"><b>${fmtDec(o.impact.trees)}</b><span>Ağac ekvivalenti (təxmini)</span></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3 class="mb">Materiallar üzrə</h3>${matBars(Object.fromEntries(MATS.map((m) => [m, { kg: o.stats.kgBy[m] || 0 }])))}</div>
    <div class="card"><div class="row between"><h3>Son təhvillər</h3><a class="small" href="#/profile">Hamısı</a></div>
      ${o.recent.length ? html`<div class="list">${o.recent.map(depRow)}</div>` : html`<div class="center" style="padding:30px 0"><div style="width:90px;margin:0 auto">${sym("tosbik-happy", "", 90)}</div><p class="mt">Hələ təhvil yoxdur. Ən yaxın məntəqəyə get və ilk tullantını at!</p><a class="btn mt" href="#/stations">📍 Məntəqələr</a></div>`}</div>
  </div>
  <div class="grid g3 mt keep2">
    <a class="card center" href="#/donate"><div style="font-size:2rem">🌳</div><b>Yaxşılığa çevir</b><div class="tiny muted">Ağacəkmə və ekoloji layihələr</div></a>
    <a class="card center" href="#/achievements"><div style="font-size:2rem">🏅</div><b>Nailiyyətlər</b><div class="tiny muted">Nişanlarını gör</div></a>
    <a class="card center" href="#/leaderboard"><div style="font-size:2rem">🎓</div><b>EcoUniversity Challenge</b><div class="tiny muted">Universitetlər arası yarış</div></a>
  </div>`);
}

/* =============== QR =============== */
async function qr(el) {
  let timer = null, expires = 0, session = null, items = 0, coins = 0, live = [];
  const draw = (q, state = "wait") => {
    mount(el, html`
    <div class="pagehead center"><span class="eyebrow">Məntəqədə tanınma</span><h1>QR kodun</h1><p>Məntəqənin kamerasına göstər və ya kodu ekrana daxil et.</p></div>
    <div class="card center" style="max-width:520px;margin:0 auto">
      ${state === "wait" ? html`
        <div class="qrbox">${raw(q.svg)}</div>
        <div class="code mt">${q.code}</div>
        <div class="row mt" style="justify-content:center"><span class="chip gold" id="cd">⏱ 2:00</span><button class="btn ghost sm" data-act="qr-new">↻ Yenilə</button></div>
        <p class="small mt">Kod 2 dəqiqə etibarlıdır və yalnız bir dəfə işləyir.</p>` : html`
        <div class="bob" style="width:130px;margin:0 auto">${sym("tosbik-happy", "", 130)}</div>
        <h2 class="mt">${S.user.name.split(" ")[0]}, məntəqəyə qoşuldun! 🎉</h2>
        <p>${session}</p>
        <div class="grid g2 mt keep2"><div class="card kpi flat" style="background:var(--g50)"><b>${items}</b><span>əşya</span></div><div class="card kpi flat" style="background:var(--goldl)"><b class="gold">+${coins}</b><span>EcoCoin</span></div></div>
        ${live.length ? html`<div class="list mt" style="text-align:left">${live.map((d) => html`<div><div class="ico">${MAT[d.material].emoji}</div><div class="grow"><b>${MAT[d.material].label} × ${d.items}</b></div><b class="gold">+${d.total}</b></div>`)}</div>` : html`<p class="mt muted">Tullantını məntəqəyə at — nəticə burada canlı görünəcək.</p>`}
        ${state === "done" ? html`<a class="btn mt" href="#/">Ana səhifə</a>` : ""}`}
    </div>
    <div class="grid g3 mt keep2" style="max-width:760px;margin-left:auto;margin-right:auto"><div class="card center"><div style="font-size:1.8rem">1️⃣</div><b>Məntəqəni tap</b></div><div class="card center"><div style="font-size:1.8rem">2️⃣</div><b>QR-ı göstər</b></div><div class="card center"><div style="font-size:1.8rem">3️⃣</div><b>Tullantını çeşidlə</b></div></div>`);
  };
  async function load() {
    try {
      const q = await post("/api/me/qr", {});
      expires = q.expiresAt; draw(q);
    } catch (e) { toast(e.message, "err"); }
  }
  on("qr-new", () => load());
  timer = setInterval(() => {
    const cd = $("#cd"); if (!cd) return;
    const s = Math.max(0, Math.round((expires - Date.now()) / 1000));
    cd.textContent = "⏱ " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if (s === 0 && !session) load();
  }, 1000);
  const onConn = (e) => { session = "Məntəqə: " + e.detail.station; items = 0; coins = 0; live = []; draw(null, "live"); };
  const onDep = (e) => { const d = e.detail; items += d.items; coins += d.total; live.unshift(d); confetti(10); draw(null, "live"); };
  const onFin = () => { draw(null, "done"); };
  document.addEventListener("ep:connected", onConn); document.addEventListener("ep:deposit", onDep); document.addEventListener("ep:finished", onFin);
  await load();
  return () => { clearInterval(timer); document.removeEventListener("ep:connected", onConn); document.removeEventListener("ep:deposit", onDep); document.removeEventListener("ep:finished", onFin); };
}

/* =============== STATIONS =============== */
async function stations(el) {
  const list = await get("/api/stations");
  mount(el, html`
  <div class="pagehead"><span class="eyebrow">Məntəqələr</span><h1>Gəncə EcoPoint şəbəkəsi</h1><p>Hər məntəqədə plastik, kağız, şüşə və metal üçün ayrıca bölmə var. Bölmənin doluluğunu burada görə bilərsən.</p></div>
  <div class="grid g3">${list.map((s) => html`
    <div class="card stationcard"><div class="row"><div class="ico">📍</div><div><h3>${s.name}</h3><div class="small muted">${s.address}</div></div></div>
      <div class="bars">${MATS.map((m) => { const b = s.bins.find((x) => x.material === m); const pct = b ? b.pct : 0; return html`<div><div class="vbar"><i style="height:${Math.max(4, pct)}%;background:${pct >= 85 ? "var(--red)" : MAT[m].color}"></i></div><small>${MAT[m].emoji} ${pct}%</small></div>`; })}</div>
      ${s.bins.some((b) => b.pct >= 85) ? html`<div class="chip red mt">⚠ Bəzi bölmələr dolmaq üzrədir</div>` : html`<div class="chip mt">✓ Bütün bölmələr açıqdır</div>`}
      ${s.lat ? html`<div class="mt"><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}">🗺️ Xəritədə aç</a></div>` : ""}
    </div>`)}</div>
  <p class="tiny muted mt">Məntəqə koordinatları nümunəvidir (pilot mərhələ).</p>`);
}

/* =============== REWARDS =============== */
async function rewards(el) {
  let tab = "shop";
  const [rw, my] = await Promise.all([get("/api/rewards"), get("/api/me/redemptions")]);
  const coins = () => S.user.coins;
  const draw = () => mount(el, html`
  <div class="pagehead row between wrap"><div><span class="eyebrow">Mükafatlar</span><h1>EcoCoin-i dəyərə çevir</h1><p>Balansın: <b class="gold">${fmt(coins())} EcoCoin</b></p></div>
    <div class="seg"><button class="${tab === "shop" ? "on" : ""}" data-act="rw-tab" data-t="shop">Mağaza</button><button class="${tab === "mine" ? "on" : ""}" data-act="rw-tab" data-t="mine">Kuponlarım (${my.length})</button></div></div>
  ${tab === "shop" ? html`<div class="grid g3">${rw.map((r) => { const ok = coins() >= r.cost; return html`
    <div class="card col"><div class="row"><div class="ico" style="font-size:1.8rem;width:56px;height:56px">${r.emoji}</div><div><h3>${r.title}</h3><div class="tiny muted">${r.partner || "EcoPoint"}</div></div></div>
      <p class="small grow">${r.description}</p>
      <div class="row between"><b class="gold" style="font-size:1.2rem">${fmt(r.cost)} EC</b><button class="btn sm ${ok ? "" : "ghost"}" data-act="redeem" data-id="${r.id}" ${ok ? "" : "disabled"}>${ok ? "Al" : fmt(r.cost - coins()) + " çatmır"}</button></div>
      ${ok ? "" : html`<div class="bar"><i style="width:${Math.min(100, (coins() / r.cost) * 100)}%"></i></div>`}</div>`; })}</div>
    <div class="card mt row"><div class="ico">🌳</div><div class="grow"><b>Mükafat əvəzinə yaxşılıq et</b><div class="small muted">EcoCoin-lərini ağacəkmə və ekoloji layihələrə bağışla.</div></div><a class="btn ghost sm" href="#/donate">Bağışla</a></div>`
  : (my.length ? html`<div class="grid g2">${my.map((c) => html`<div class="coupon"><div class="row"><div class="ico" style="background:#fff">${c.emoji}</div><div class="grow"><b>${c.title}</b><div class="tiny muted">${c.partner || "EcoPoint"} · ${dateFmt(c.created_at)}</div></div><span class="chip ${c.status === "active" ? "" : "gray"}">${c.status === "active" ? "Aktiv" : "İstifadə olunub"}</span></div><div class="cc mt">${c.code}</div><div class="tiny muted">Bu kodu tərəfdaşın kassasında göstər.</div></div>`)}</div>` : html`<div class="card center"><p>Hələ kuponun yoxdur.</p><button class="btn mt" data-act="rw-tab" data-t="shop">Mağazaya get</button></div>`)}`);
  on("rw-tab", (b) => { tab = b.dataset.t; draw(); });
  on("redeem", async (b) => {
    b.disabled = true;
    try {
      const r = await post(`/api/rewards/${b.dataset.id}/redeem`, {});
      setCoins(r.balance);
      confetti(30);
      modal(html`<div class="center"><div style="width:110px;margin:0 auto" class="bob">${sym("tosbik-happy", "", 110)}</div><h2 class="mt">${r.redemption.emoji} ${r.redemption.title}</h2><p>Kuponun hazırdır! Kodu tərəfdaşın kassasında göstər:</p><div class="coupon mt"><div class="cc">${r.redemption.code}</div></div><button class="btn mt" data-close>Əla!</button></div>`);
      my.unshift({ id: r.redemption.id, code: r.redemption.code, status: "active", title: r.redemption.title, emoji: r.redemption.emoji, created_at: new Date().toISOString().slice(0, 19).replace("T", " "), partner: (rw.find((x) => x.id === Number(b.dataset.id)) || {}).partner });
      draw();
    } catch (e) { toast(e.message, "err"); b.disabled = false; }
  });
  draw();
}

/* =============== DONATE =============== */
async function donate(el) {
  const ps = await get("/api/projects");
  const draw = () => mount(el, html`
  <div class="pagehead"><span class="eyebrow">Bağış</span><h1>Mükafat seç və ya yaxşılığa çevir 🌍</h1><p>Balansın: <b class="gold">${fmt(S.user.coins)} EcoCoin</b>. Bağışlar ekoloji layihələrə yönləndirilir.</p></div>
  <div class="grid g3">${ps.map((p) => { const pct = Math.min(100, Math.round((p.raised_coins / p.goal_coins) * 100)); return html`
    <div class="card col"><div class="row"><div class="ico" style="font-size:1.8rem;width:56px;height:56px">${p.emoji}</div><h3>${p.title}</h3></div><p class="small grow">${p.description}</p>
      <div><div class="row between tiny"><b>${fmt(p.raised_coins)} EC</b><span class="muted">məqsəd ${fmt(p.goal_coins)}</span></div><div class="bar tall"><i style="width:${pct}%"></i></div></div>
      <button class="btn" data-act="donate" data-id="${p.id}">❤ Bağışla</button></div>`; })}</div>`);
  on("donate", (b) => {
    const p = ps.find((x) => x.id === Number(b.dataset.id));
    const m = modal(html`<h2>${p.emoji} ${p.title}</h2><p class="mb">Neçə EcoCoin bağışlamaq istəyirsən?</p><div class="row wrap mb">${[50, 100, 250, 500].map((n) => html`<button class="chip" style="border:none;cursor:pointer" data-act="amt" data-n="${n}">${n}</button>`)}</div>
      <form data-form="donate-go"><div class="field"><input type="number" name="coins" id="dn" min="10" step="10" value="50" required></div><div id="dnerr"></div><button class="btn block" type="submit">Bağışla</button></form>`);
    on("amt", (c) => { $("#dn").value = c.dataset.n; });
    on("donate-go", async (f, d) => {
      try {
        const r = await post(`/api/projects/${p.id}/donate`, { coins: Number(d.coins) });
        setCoins(r.balance); m.close(); confetti(26); toast("Təşəkkür edirik! 🌳 Bağışın qəbul olundu", "gold");
        p.raised_coins += Number(d.coins); draw();
      } catch (e) { mount($("#dnerr"), html`<div class="err">${e.message}</div>`); }
    });
  });
  draw();
}

/* =============== LEADERBOARD =============== */
async function leaderboard(el) {
  let tab = "orgs", period = "month";
  const cache = {};
  const data = async () => (cache[period] ||= await get("/api/leaderboard?period=" + period));
  const orgTypeLabel = { university: "Universitet", school: "Məktəb", company: "Şirkət" };
  async function draw() {
    const d = await data();
    const end = new Date(); const daysLeft = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() - end.getDate();
    mount(el, html`
    <div class="pagehead row between wrap"><div><span class="eyebrow">Reytinq</span><h1>${tab === "orgs" ? "EcoUniversity Challenge 🎓" : "İstifadəçi reytinqi 🏆"}</h1><p>${tab === "orgs" ? "Universitetlər arası aylıq yarış — komandana xal qazandır." : "Ən çox EcoCoin qazanan istifadəçilər."}${period === "month" ? ` Ay sonuna ${daysLeft} gün qalıb.` : ""}</p></div>
      <div class="col" style="align-items:flex-end"><div class="seg"><button class="${tab === "orgs" ? "on" : ""}" data-act="lb-tab" data-t="orgs">Təşkilatlar</button><button class="${tab === "users" ? "on" : ""}" data-act="lb-tab" data-t="users">İstifadəçilər</button></div>
      <div class="seg"><button class="${period === "month" ? "on" : ""}" data-act="lb-per" data-t="month">Bu ay</button><button class="${period === "all" ? "on" : ""}" data-act="lb-per" data-t="all">Bütün vaxt</button></div></div></div>
    ${tab === "orgs" ? board(d.orgs.map((o) => ({ rank: o.rank, name: o.name, sub: `${orgTypeLabel[o.type] || o.type} · ${o.members} iştirakçı · ${fmtKg(o.kg)}`, pts: o.pts, me: o.mine }))) : board(d.users.map((u) => ({ rank: u.rank, name: u.name + (u.demo ? " (demo)" : ""), sub: `${u.org || "Fərdi"} · ${fmtKg(u.kg)}`, pts: u.pts, me: u.me })))}
    ${tab === "orgs" && !S.user.org ? html`<div class="card mt row"><div class="ico">🎓</div><div class="grow"><b>Hələ heç bir təşkilata qoşulmamısan</b><div class="small muted">Profilindən universitetini seç və komandana xal qazandır.</div></div><a class="btn sm" href="#/profile">Profil</a></div>` : ""}
    <p class="tiny muted mt">${tab === "users" ? "Məxfilik üçün soyadlar qısaldılır. " : ""}Xallar = qazanılmış EcoCoin (bonuslar daxil).</p>`);
  }
  const board = (rows) => {
    if (!rows.length) return html`<div class="card center"><p>Bu dövr üçün hələ nəticə yoxdur.</p></div>`;
    const top = rows.slice(0, 3), rest = rows.slice(3), medals = ["🥇", "🥈", "🥉"];
    const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
    return html`<div class="podium">${order.map((r) => html`<div class="${r.rank === 1 ? "p1" : ""}"><div class="medal">${medals[r.rank - 1]}</div><b style="display:block;font-size:.95rem">${r.name}</b><div class="gold" style="font-weight:800">${fmt(r.pts)}</div><div class="tiny muted">xal</div></div>`)}</div>
      <div class="card" style="padding:10px">${rest.map((r) => html`<div class="lbrow ${r.me ? "me" : ""}"><div class="rk">${r.rank}</div><div class="grow"><b>${r.name}</b>${r.me ? html` <span class="chip">sən</span>` : ""}<div class="tiny muted">${r.sub}</div></div><b class="gold">${fmt(r.pts)}</b></div>`)}${rest.length ? "" : html`<div class="center small muted" style="padding:14px">Daha çox iştirakçı gözlənilir…</div>`}</div>`;
  };
  on("lb-tab", (b) => { tab = b.dataset.t; draw(); });
  on("lb-per", (b) => { period = b.dataset.t; draw(); });
  await draw();
}

/* =============== ACHIEVEMENTS =============== */
async function achievements(el) {
  const list = await get("/api/me/achievements");
  const n = list.filter((a) => a.unlocked).length;
  mount(el, html`<div class="pagehead"><span class="eyebrow">Nailiyyətlər</span><h1>${n} / ${list.length} nişan</h1><p>Təhvil ver, bağışla və seriya topla — nişanlar avtomatik açılır.</p></div>
  <div class="bar tall gold mb"><i style="width:${(n / list.length) * 100}%"></i></div>
  <div class="grid g4 keep2">${list.map((a) => html`<div class="badge ${a.unlocked ? "" : "lock"}"><div class="em">${a.emoji}</div><b>${a.title}</b><div class="tiny muted" style="margin-top:4px">${a.desc}</div>${a.unlocked ? html`<div class="chip gold" style="margin-top:8px">✓ ${ago(a.unlocked_at)}</div>` : ""}</div>`)}</div>`);
}

/* =============== PROFILE =============== */
async function profile(el) {
  const [orgs, deps] = await Promise.all([get("/api/orgs"), S.user.role === "user" ? get("/api/me/deposits?limit=40") : Promise.resolve([])]);
  mount(el, html`
  <div class="pagehead"><span class="eyebrow">Profil</span><h1>${S.user.name}</h1><p>${S.user.email} · ${{ user: "İstifadəçi", business: "Təşkilat meneceri", admin: "Administrator" }[S.user.role]}</p></div>
  <div class="grid g2">
    <div class="card"><h3 class="mb">Məlumatlar</h3><div id="pmsg"></div>
      <form data-form="prof"><div class="field"><label>Ad və soyad</label><input type="text" name="name" value="${S.user.name}" required minlength="2" maxlength="60"></div>
      ${S.user.role === "user" ? html`<div class="field"><label>Universitet / təşkilat</label><select name="org_id"><option value="">— yoxdur —</option>${orgs.filter((o) => o.type !== "partner").map((o) => html`<option value="${o.id}" ${S.user.org && S.user.org.id === o.id ? "selected" : ""}>${o.name}</option>`)}</select></div>` : html`<div class="field"><label>Təşkilat</label><input type="text" value="${S.user.org ? S.user.org.name : "—"}" disabled></div>`}
      <button class="btn" type="submit">Yadda saxla</button></form></div>
    <div class="card"><h3 class="mb">Parolu dəyiş</h3><div id="pwmsg"></div>
      <form data-form="pw"><div class="field"><label>Cari parol</label><input type="password" name="current" required autocomplete="current-password"></div><div class="field"><label>Yeni parol (min. 8)</label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div><button class="btn" type="submit">Dəyiş</button></form>
      <hr style="border:none;border-top:1px solid var(--line);margin:22px 0"><button class="btn ghost" data-act="logout">Çıxış</button></div>
  </div>
  ${S.user.role === "user" ? html`<div class="card mt"><h3>Təhvil tarixçəsi</h3>${deps.length ? html`<div class="list">${deps.map(depRow)}</div>` : html`<p class="mt">Hələ təhvil yoxdur.</p>`}</div>` : ""}`);
  on("prof", async (f, d) => {
    try { const r = await patch("/api/me", { name: d.name, ...(d.org_id !== undefined ? { org_id: d.org_id ? Number(d.org_id) : null } : {}) }); S.user = r.user; mount($("#pmsg"), html`<div class="chip mb">✓ Yadda saxlanıldı</div>`); }
    catch (e) { mount($("#pmsg"), html`<div class="err">${e.message}</div>`); }
  });
  on("pw", async (f, d) => {
    try { await post("/api/me/password", d); f.reset(); mount($("#pwmsg"), html`<div class="chip mb">✓ Parol dəyişdirildi</div>`); }
    catch (e) { mount($("#pwmsg"), html`<div class="err">${e.message}</div>`); }
  });
}

export const userViews = {
  "/": { render: home }, "/qr": { render: qr }, "/stations": { render: stations }, "/rewards": { render: rewards },
  "/donate": { render: donate }, "/leaderboard": { render: leaderboard }, "/achievements": { render: achievements }, "/profile": { render: profile },
};
