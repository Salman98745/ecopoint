import { html, raw, mount, $, $$, get, post, put, patch, del, on, toast, modal, confirmBox, MAT, MATS, fmt, fmtKg, fmtAzn, dateFmt, barChart, donut, matBars, esc } from "./core.js";
import { S } from "./state.js";

/* ---------- overview ---------- */
async function overview(el) {
  const o = await get("/api/admin/overview");
  mount(el, html`
  <div class="pagehead"><span class="eyebrow">İdarəetmə</span><h1>Sistem icmalı</h1><p>EcoPoint şəbəkəsinin ümumi vəziyyəti.</p></div>
  ${o.alerts.length ? html`<div class="card mb" style="background:var(--redl);border-color:transparent"><b class="red">⚠ ${o.alerts.length} bölmə dolmaq üzrədir</b><div class="small mt">${o.alerts.map((a) => html`<span class="chip red" style="margin:2px">${a.station} · ${MAT[a.material].label} ${a.pct}%</span>`)}</div><a class="btn sm mt" href="#/admin/stations">Məntəqələrə keç</a></div>` : ""}
  <div class="grid g4 keep2">
    <div class="card kpi dark"><b>${fmt(o.users)}</b><span>İstifadəçi</span></div>
    <div class="card kpi dark"><b>${fmtKg(o.kg)}</b><span>Toplanmış material</span></div>
    <div class="card kpi dark"><b>${fmt(o.deposits)}</b><span>Təhvil əməliyyatı</span></div>
    <div class="card kpi dark"><b>${fmt(o.redemptionsActive)}</b><span>Aktiv kupon</span></div>
  </div>
  <div class="grid g21 mt">
    <div class="card"><h3 class="mb">Son 14 gün (kq)</h3>${barChart(o.series.map((s) => ({ label: s.day.slice(3), kg: s.kg })), { color: "#2ea36f" })}</div>
    <div class="card"><h3 class="mb">Material payı</h3><div class="center">${donut(MATS.map((m) => ({ value: (o.kgBy.find((r) => r.material === m) || { kg: 0 }).kg, color: MAT[m].hex })), { center: fmt(o.kg), sub: "kq" })}</div><div class="row wrap mt" style="justify-content:center">${MATS.map((m) => html`<span class="small"><span class="matdot m-${m}"></span>${MAT[m].label}</span>`)}</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3 class="mb">EcoCoin dövriyyəsi</h3><div class="list">
      <div><div class="grow">Buraxılmış (qazanılmış)</div><b>${fmt(o.coinsIssued)}</b></div><div><div class="grow">İstifadəçilərdə qalıq</div><b>${fmt(o.coinsHeld)}</b></div>
      <div><div class="grow">Mükafata xərclənmiş</div><b>${fmt(o.coinsRedeemed)}</b></div><div><div class="grow">Bağışlanmış</div><b>${fmt(o.coinsDonated)}</b></div></div></div>
    <div class="card"><h3 class="mb">Maliyyə (təxmini)</h3><div class="list">
      <div><div class="grow">Material satışından gəlir (boşaltmalar)</div><b>${fmtAzn(o.revenue)}</b></div>
      <div><div class="grow">Hazırda bölmələrdəki materialın dəyəri</div><b>${fmtAzn(o.potential)}</b></div>
      <div><div class="grow">Reklam gəliri (aylıq, aktiv slotlar)</div><b>${fmtAzn(o.adRevenue)}</b></div></div>
      <p class="tiny muted mt">Qiymətlər “Parametrlər” bölməsindəki material tarifləri əsasında hesablanır.</p></div>
  </div>`);
}

/* ---------- stations ---------- */
async function stationsView(el) {
  async function draw() {
    const list = await get("/api/admin/stations");
    mount(el, html`
    <div class="pagehead row between wrap"><div><span class="eyebrow">Məntəqələr</span><h1>Məntəqə idarəetməsi</h1><p>Doluluq, boşaltma və kiosk açarları.</p></div><button class="btn" data-act="st-new">+ Yeni məntəqə</button></div>
    <div class="grid g2">${list.map((s) => html`
      <div class="card stationcard" style="${s.active ? "" : "opacity:.6"}">
        <div class="row between"><div class="row"><div class="ico">📍</div><div><h3>${s.name}</h3><div class="small muted">${s.address || "—"}</div></div></div>${s.active ? html`<span class="chip">Aktiv</span>` : html`<span class="chip gray">Deaktiv</span>`}</div>
        <div class="bars">${s.bins.map((b) => html`<div><div class="vbar"><i style="height:${Math.max(4, b.pct)}%;background:${b.pct >= 85 ? "var(--red)" : MAT[b.material].color}"></i></div><small>${MAT[b.material].emoji} ${b.pct}%<br>${b.fill_kg} kq</small></div>`)}</div>
        <div class="small muted mt">Cəmi: ${fmt(s.totals.deposits)} təhvil · ${fmtKg(s.totals.kg)}</div>
        <div class="row wrap mt"><button class="btn sm" data-act="st-collect" data-id="${s.id}">🚚 Hamısını boşalt</button><button class="btn ghost sm" data-act="st-key" data-id="${s.id}">🔑 Kiosk açarı</button><button class="btn ghost sm" data-act="st-toggle" data-id="${s.id}" data-a="${s.active ? 0 : 1}">${s.active ? "Deaktiv et" : "Aktiv et"}</button></div>
      </div>`)}</div>`);
    on("st-new", () => {
      const m = modal(html`<h2 class="mb">Yeni məntəqə</h2><div id="sterr"></div><form data-form="st-create"><div class="field"><label>Ad</label><input type="text" name="name" required maxlength="80"></div><div class="field"><label>Ünvan</label><input type="text" name="address" maxlength="160"></div><div class="row"><div class="field grow"><label>Enlik</label><input type="number" step="any" name="lat"></div><div class="field grow"><label>Uzunluq</label><input type="number" step="any" name="lng"></div></div><button class="btn block" type="submit">Yarat</button></form>`);
      on("st-create", async (f, d) => { try { const r = await post("/api/admin/stations", d); m.close(); keyModal(r.id, r.key, d.name); draw(); } catch (e) { mount($("#sterr"), html`<div class="err">${e.message}</div>`); } });
    });
    on("st-collect", async (b) => { if (!(await confirmBox("Bütün bölmələr boşaldılsın? (material satışa göndərilir)"))) return; try { const r = await post(`/api/admin/stations/${b.dataset.id}/collect`, { material: "all" }); toast(`Boşaldıldı: ${r.kg} kq → ${fmtAzn(r.revenue)}`, "gold"); draw(); } catch (e) { toast(e.message, "err"); } });
    on("st-key", async (b) => { if (!(await confirmBox("Yeni kiosk açarı yaradılsın? Köhnə açar dərhal işləməyəcək."))) return; try { const r = await post(`/api/admin/stations/${b.dataset.id}/key`, {}); keyModal(r.id, r.key, ""); } catch (e) { toast(e.message, "err"); } });
    on("st-toggle", async (b) => { try { await patch(`/api/admin/stations/${b.dataset.id}`, { active: b.dataset.a === "1" }); draw(); } catch (e) { toast(e.message, "err"); } });
  }
  function keyModal(id, key, name) {
    modal(html`<h2>🔑 Kiosk açarı</h2><p class="mb">${name ? name + " — " : ""}Açarı indi kopyala, sonra yenidən göstərilməyəcək.</p><div class="coupon"><div class="small muted">Məntəqə #${id}</div><div class="cc" style="font-size:.9rem;word-break:break-all">${key}</div></div><a class="btn block mt" target="_blank" rel="noopener" href="kiosk.html#id=${id}&key=${key}">🖥️ Kiosku aç və aktivləşdir</a><button class="btn ghost block mt" data-close>Bağla</button>`);
  }
  await draw();
}

/* ---------- users ---------- */
async function users(el) {
  let q = "";
  const orgs = await get("/api/admin/orgs");
  async function draw() {
    const list = await get("/api/admin/users?q=" + encodeURIComponent(q));
    mount(el, html`
    <div class="pagehead row between wrap"><div><span class="eyebrow">İstifadəçilər</span><h1>İstifadəçi idarəetməsi</h1></div><input type="text" id="uq" placeholder="Ad və ya e-poçt axtar…" value="${q}" style="max-width:280px"></div>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Ad</th><th>E-poçt</th><th>Rol</th><th>Təşkilat</th><th>EcoCoin</th><th></th></tr></thead><tbody>${list.map((u) => html`<tr>
      <td><b>${u.name}</b>${u.is_demo ? html` <span class="chip gray">demo</span>` : ""}</td><td class="muted">${u.email}</td>
      <td><select data-u="${u.id}" data-f="role" style="width:auto;padding:6px 10px">${["user", "business", "admin"].map((r) => html`<option value="${r}" ${u.role === r ? "selected" : ""}>${{ user: "İstifadəçi", business: "Təşkilat", admin: "Admin" }[r]}</option>`)}</select></td>
      <td><select data-u="${u.id}" data-f="org_id" style="width:auto;padding:6px 10px;max-width:190px"><option value="">—</option>${orgs.map((o) => html`<option value="${o.id}" ${u.org_id === o.id ? "selected" : ""}>${o.name}</option>`)}</select></td>
      <td><b class="gold">${fmt(u.coins)}</b></td><td><button class="btn sm" data-act="u-save" data-u="${u.id}">Saxla</button></td></tr>`)}</tbody></table></div></div>`);
    $("#uq").addEventListener("change", (e) => { q = e.target.value; draw(); });
  }
  on("u-save", async (b) => {
    const id = b.dataset.u; const role = $(`select[data-u="${id}"][data-f="role"]`).value; const org = $(`select[data-u="${id}"][data-f="org_id"]`).value;
    try { await patch(`/api/admin/users/${id}`, { role, org_id: org ? Number(org) : null }); toast("Yadda saxlanıldı"); } catch (e) { toast(e.message, "err"); }
  });
  await draw();
}

/* ---------- generic CRUD ---------- */
function crudView(table, title, eyebrow, fields, cols) {
  return async (el) => {
    const orgs = fields.some((f) => f.type === "org") ? await get("/api/admin/orgs") : [];
    async function draw() {
      const rows = await get(`/api/admin/${table}`);
      mount(el, html`
      <div class="pagehead row between wrap"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1></div><button class="btn" data-act="c-new">+ Əlavə et</button></div>
      <div class="card"><div class="tablewrap"><table><thead><tr>${cols.map((c) => html`<th>${c.h}</th>`)}<th></th></tr></thead><tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td>${c.f(r, orgs)}</td>`)}<td class="right" style="white-space:nowrap"><button class="btn ghost sm" data-act="c-edit" data-id="${r.id}">Redaktə</button> <button class="btn ghost sm" data-act="c-del" data-id="${r.id}">✕</button></td></tr>`)}</tbody></table></div>${rows.length ? "" : html`<p class="center">Boşdur.</p>`}</div>`);
      const form = (r) => html`${fields.map((f) => f.type === "bool" ? html`<div class="field"><label><input type="checkbox" name="${f.name}" ${(r ? r[f.name] : 1) ? "checked" : ""} style="width:auto"> ${f.label}</label></div>` : f.type === "org" ? html`<div class="field"><label>${f.label}</label><select name="${f.name}"><option value="">—</option>${orgs.map((o) => html`<option value="${o.id}" ${r && r[f.name] === o.id ? "selected" : ""}>${o.name}</option>`)}</select></div>` : f.type === "select" ? html`<div class="field"><label>${f.label}</label><select name="${f.name}">${f.options.map(([v, l]) => html`<option value="${v}" ${(r ? r[f.name] : f.options[0][0]) === v ? "selected" : ""}>${l}</option>`)}</select></div>` : html`<div class="field"><label>${f.label}</label><input type="${f.type === "number" ? "number" : "text"}" name="${f.name}" value="${r && r[f.name] !== null && r[f.name] !== undefined ? r[f.name] : f.def ?? ""}" ${f.step ? `step="${f.step}"` : ""} ${f.optional ? "" : "required"}></div>`)}`;
      const collect = (d) => Object.fromEntries(fields.map((f) => [f.name, f.type === "bool" ? d[f.name] === "on" : f.type === "number" ? (d[f.name] === "" ? null : Number(d[f.name])) : f.type === "org" ? (d[f.name] ? Number(d[f.name]) : null) : d[f.name]]));
      const open = (r) => {
        const m = modal(html`<h2 class="mb">${r ? "Redaktə" : "Yeni"}</h2><div id="cerr"></div><form data-form="c-save">${form(r)}<button class="btn block" type="submit">Yadda saxla</button></form>`);
        on("c-save", async (f, d) => { try { r ? await put(`/api/admin/${table}/${r.id}`, collect(d)) : await post(`/api/admin/${table}`, collect(d)); m.close(); draw(); } catch (e) { mount($("#cerr"), html`<div class="err">${e.message}</div>`); } });
      };
      on("c-new", () => open(null));
      on("c-edit", (b) => open(rows.find((x) => x.id === Number(b.dataset.id))));
      on("c-del", async (b) => { if (await confirmBox("Silinsin?")) { try { await del(`/api/admin/${table}/${b.dataset.id}`); draw(); } catch (e) { toast(e.message, "err"); } } });
    }
    await draw();
  };
}
const yes = (v) => (v ? html`<span class="chip">Aktiv</span>` : html`<span class="chip gray">Deaktiv</span>`);
const rewardsView = crudView("rewards", "Mükafatlar", "Mükafat mağazası", [
  { name: "title", label: "Ad" }, { name: "description", label: "Təsvir", optional: true }, { name: "cost", label: "Qiymət (EcoCoin)", type: "number" }, { name: "emoji", label: "Emoji", def: "🎁" },
  { name: "partner_org_id", label: "Tərəfdaş", type: "org" }, { name: "stock", label: "Stok (boş = limitsiz)", type: "number", optional: true }, { name: "active", label: "Aktiv", type: "bool" },
], [{ h: "Mükafat", f: (r) => html`${r.emoji} <b>${r.title}</b>` }, { h: "Qiymət", f: (r) => html`<b class="gold">${fmt(r.cost)}</b>` }, { h: "Tərəfdaş", f: (r, orgs) => (orgs.find((o) => o.id === r.partner_org_id) || { name: "—" }).name }, { h: "Stok", f: (r) => (r.stock === null ? "∞" : r.stock) }, { h: "Status", f: (r) => yes(r.active) }]);
const projectsView = crudView("projects", "Ekoloji layihələr", "Bağış layihələri", [
  { name: "title", label: "Ad" }, { name: "description", label: "Təsvir", optional: true }, { name: "emoji", label: "Emoji", def: "🌳" }, { name: "goal_coins", label: "Məqsəd (EcoCoin)", type: "number" }, { name: "active", label: "Aktiv", type: "bool" },
], [{ h: "Layihə", f: (r) => html`${r.emoji} <b>${r.title}</b>` }, { h: "Toplanıb", f: (r) => html`${fmt(r.raised_coins)} / ${fmt(r.goal_coins)}` }, { h: "Status", f: (r) => yes(r.active) }]);
const orgsView = crudView("orgs", "Təşkilatlar", "Universitetlər və tərəfdaşlar", [
  { name: "name", label: "Ad" }, { name: "type", label: "Növ", type: "select", options: [["university", "Universitet"], ["school", "Məktəb"], ["company", "Şirkət"], ["partner", "Mükafat tərəfdaşı"]] },
], [{ h: "Ad", f: (r) => html`<b>${r.name}</b>` }, { h: "Növ", f: (r) => ({ university: "Universitet", school: "Məktəb", company: "Şirkət", partner: "Mükafat tərəfdaşı" }[r.type] || r.type) }]);
const adsView = crudView("ads", "Reklam slotları", "Kiosk ekranlarında reklam", [
  { name: "advertiser", label: "Reklamçı" }, { name: "text", label: "Reklam mətni" }, { name: "emoji", label: "Emoji", def: "📢" }, { name: "monthly_price", label: "Aylıq qiymət (AZN)", type: "number", step: "any", def: 100 }, { name: "active", label: "Aktiv", type: "bool" },
], [{ h: "Reklamçı", f: (r) => html`${r.emoji} <b>${r.advertiser}</b>` }, { h: "Mətn", f: (r) => r.text }, { h: "Aylıq", f: (r) => fmtAzn(r.monthly_price) }, { h: "Status", f: (r) => yes(r.active) }]);

/* ---------- settings ---------- */
async function settings(el) {
  const s = await get("/api/admin/settings");
  mount(el, html`
  <div class="pagehead"><span class="eyebrow">Parametrlər</span><h1>Material tarifləri</h1><p>EcoCoin dərəcələri, çəki, satış qiyməti və bölmə tutumu. Dəyişikliklər dərhal tətbiq olunur.</p></div>
  <div class="card"><div id="smsg"></div><form data-form="set-save"><div class="tablewrap"><table><thead><tr><th>Material</th><th>EcoCoin / əşya</th><th>Çəki (kq / əşya)</th><th>Satış qiyməti (AZN/kq)</th><th>CO₂ (kq/kq)</th><th>Bölmə tutumu (kq)</th></tr></thead><tbody>
    ${MATS.map((m) => html`<tr><td><b>${MAT[m].emoji} ${MAT[m].label}</b></td>${["coins", "kg", "price", "co2", "capacity"].map((k) => html`<td><input type="number" step="any" name="${m}.${k}" value="${s.rates[m][k]}" required style="min-width:90px"></td>`)}</tr>`)}</tbody></table></div><button class="btn mt" type="submit">Yadda saxla</button></form></div>`);
  on("set-save", async (f, d) => {
    const rates = {}; MATS.forEach((m) => { rates[m] = {}; ["coins", "kg", "price", "co2", "capacity"].forEach((k) => (rates[m][k] = Number(d[`${m}.${k}`]))); });
    try { await put("/api/admin/settings", { rates }); mount($("#smsg"), html`<div class="chip mb">✓ Yadda saxlanıldı</div>`); } catch (e) { mount($("#smsg"), html`<div class="err">${e.message}</div>`); }
  });
}

export const adminViews = {
  "/admin": { render: overview }, "/admin/stations": { render: stationsView }, "/admin/users": { render: users }, "/admin/rewards": { render: rewardsView },
  "/admin/projects": { render: projectsView }, "/admin/orgs": { render: orgsView }, "/admin/ads": { render: adsView }, "/admin/settings": { render: settings },
};
