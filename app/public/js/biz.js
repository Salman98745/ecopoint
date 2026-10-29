import { html, raw, mount, $, get, post, on, toast, MAT, MATS, fmt, fmtDec, fmtKg, ago, dateFmt, barChart, donut, matBars } from "./core.js";
import { S } from "./state.js";

const monthLabel = (m) => { const [y, mm] = m.split("-"); return ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"][Number(mm) - 1] + " " + y.slice(2); };

async function dashboard(el) {
  let month = null;
  async function draw() {
    const d = await get("/api/biz/dashboard" + (month ? "?month=" + month : ""));
    month = d.month;
    const months = d.series.map((s) => s.month);
    mount(el, html`
    <div class="pagehead row between wrap"><div><span class="eyebrow">Müəssisə paneli</span><h1>${d.org.name}</h1><p>Təşkilatın tullantı və təkrar emal göstəriciləri.</p></div>
      <div class="row"><select id="mon" style="width:auto">${months.slice().reverse().map((m) => html`<option value="${m}" ${m === month ? "selected" : ""}>${monthLabel(m)}</option>`)}</select><button class="btn ghost sm" data-act="csv">⬇ CSV hesabat</button></div></div>
    <div class="grid g4 keep2">
      <div class="card kpi dark"><b>${fmtKg(d.sortedKg)}</b><span>Çeşidlənmiş tullantı</span></div>
      <div class="card kpi"><b>${d.recycledPct === null ? "—" : d.recycledPct + "%"}</b><span>Təkrar emal faizi ${d.recycledPct === null ? "(jurnalı doldur)" : ""}</span></div>
      <div class="card kpi"><b>${fmt(d.members)}</b><span>İştirakçı</span></div>
      <div class="card kpi"><b>${fmtDec(d.co2)} kq</b><span>CO₂ qənaəti (təxmini)</span></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><h3 class="mb">Material üzrə (${monthLabel(month)})</h3><div class="row wrap" style="gap:24px"><div>${donut(MATS.map((m) => ({ value: d.byMat[m].kg, color: MAT[m].hex })), { center: fmt(d.sortedKg), sub: "kq" })}</div><div class="grow" style="min-width:200px">${matBars(d.byMat)}</div></div></div>
      <div class="card"><h3 class="mb">Son 6 ay (kq)</h3>${barChart(d.series.map((s) => ({ label: monthLabel(s.month).split(" ")[0], kg: s.kg })), { unit: "" })}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><h3>Ümumi tullantı jurnalı</h3><p class="small mb">Təkrar emal faizini hesablamaq üçün ayda yaranan <b>ümumi</b> tullantı miqdarını (kq) daxil et. Faiz = çeşidlənmiş ÷ ümumi.</p><div id="wl"></div>
        <form data-form="wlog" class="row"><input type="number" name="total_kg" min="0" step="0.1" required placeholder="məs. 500" value="${d.totalLogged ?? ""}"><button class="btn" type="submit">Yadda saxla</button></form>
        ${d.recycledPct !== null ? html`<div class="mt"><div class="row between small"><b>Təkrar emal səviyyəsi</b><span>${d.recycledPct}%</span></div><div class="bar tall"><i style="width:${d.recycledPct}%"></i></div></div>` : ""}</div>
      <div class="card"><h3 class="mb">Ən aktiv iştirakçılar</h3>${d.top.length ? html`<div class="list">${d.top.map((t, i) => html`<div><div class="ico">${["🥇", "🥈", "🥉", "4", "5"][i]}</div><div class="grow"><b>${t.name}</b><div class="tiny muted">${fmtKg(t.kg)}</div></div><b class="gold">${fmt(t.pts)}</b></div>`)}</div>` : html`<p>Bu ay hələ təhvil yoxdur.</p>`}</div>
    </div>`);
    $("#mon").onchange = (e) => { month = e.target.value; draw(); };
    on("csv", () => {
      const rows = [["Material", "Əşya", "Kq", "EcoCoin"], ...MATS.map((m) => [MAT[m].label, d.byMat[m].items, d.byMat[m].kg, d.byMat[m].coins]), [], ["Çeşidlənmiş (kq)", d.sortedKg], ["Ümumi tullantı (kq)", d.totalLogged ?? ""], ["Təkrar emal %", d.recycledPct ?? ""]];
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `ecopoint-${month}.csv`; a.click();
    });
    on("wlog", async (f, v) => { try { await post("/api/biz/waste-log", { month, total_kg: Number(v.total_kg) }); toast("Yadda saxlanıldı"); draw(); } catch (e) { toast(e.message, "err"); } });
  }
  await draw();
}

async function coupons(el) {
  async function draw() {
    const list = await get("/api/biz/coupons");
    mount(el, html`
    <div class="pagehead"><span class="eyebrow">Kuponlar</span><h1>Kupon təsdiqi</h1><p>Müştəri kuponunun kodunu daxil et — təsdiqləndikdən sonra kupon bir daha işləməz.</p></div>
    <div class="card" style="max-width:520px"><div id="vmsg"></div><form data-form="validate" class="row"><input type="text" name="code" placeholder="EP-XXXX-XXXX" required maxlength="30" style="text-transform:uppercase;letter-spacing:.1em;font-weight:700"><button class="btn" type="submit">Təsdiq et</button></form></div>
    <div class="card mt"><h3 class="mb">Son kuponlar</h3>${list.length ? html`<div class="tablewrap"><table><thead><tr><th>Kod</th><th>Mükafat</th><th>Müştəri</th><th>Status</th><th>Tarix</th></tr></thead><tbody>${list.map((c) => html`<tr><td><b style="font-family:ui-monospace,monospace">${c.code}</b></td><td>${c.emoji} ${c.title}</td><td>${c.name}</td><td><span class="chip ${c.status === "active" ? "" : "gray"}">${c.status === "active" ? "Aktiv" : "İstifadə olunub"}</span></td><td class="muted">${dateFmt(c.created_at)}</td></tr>`)}</tbody></table></div>` : html`<p>Bu təşkilat üçün hələ kupon alınmayıb.${S.user.org && S.user.org.type !== "partner" ? " (Kupon təsdiqi yalnız mükafat tərəfdaşları üçündür.)" : ""}</p>`}</div>`);
  }
  on("validate", async (f, v) => {
    try { const r = await post("/api/biz/coupons/validate", { code: v.code }); mount($("#vmsg"), html`<div class="chip mb" style="font-size:.95rem">✓ ${r.emoji} ${r.title} — ${r.customer} üçün təsdiqləndi</div>`); toast("Kupon təsdiqləndi", "gold"); setTimeout(draw, 1400); }
    catch (e) { mount($("#vmsg"), html`<div class="err">${e.message}</div>`); }
  });
  await draw();
}

export const bizViews = { "/biz": { render: dashboard }, "/biz/coupons": { render: coupons } };
