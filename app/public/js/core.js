// Core helpers: safe templating, API client, UI primitives, charts.
export const MAT = {
  plastik: { label: "Plastik", emoji: "🥤", color: "var(--c-plastik)", hex: "#2f6fb5" },
  kagiz: { label: "Kağız", emoji: "📄", color: "var(--c-kagiz)", hex: "#f0b429" },
  shushe: { label: "Şüşə", emoji: "🍾", color: "var(--c-shushe)", hex: "#2ea36f" },
  metal: { label: "Metal", emoji: "🔩", color: "var(--c-metal)", hex: "#5b6b73" },
};
export const MATS = Object.keys(MAT);

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const raw = (s) => ({ __raw: String(s ?? "") });
const one = (v) => (v && v.__raw !== undefined ? v.__raw : esc(v));
// html`...` escapes every interpolation unless it is itself html`` / raw()
export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) { const v = vals[i]; out += Array.isArray(v) ? v.map(one).join("") : one(v); }
  });
  return raw(out);
}
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export function mount(el, tpl) { el.innerHTML = tpl.__raw; }

export const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("az").replace(/,/g, " ");
export const fmtDec = (n) => (Number(n) || 0).toLocaleString("en", { maximumFractionDigits: 2 }).replace(/\./g, ",").replace(/,(?=\d{3}(\D|$))/g, " ");
export const fmtKg = (n) => (Number(n) || 0).toLocaleString("az", { maximumFractionDigits: 1 }).replace(/\./g, ",") + " kq";
export const fmtAzn = (n) => (Number(n) || 0).toFixed(2).replace(".", ",") + " AZN";
export function ago(sql) {
  const t = new Date(String(sql).replace(" ", "T") + "Z").getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "indicə";
  if (s < 3600) return Math.floor(s / 60) + " dəq əvvəl";
  if (s < 86400) return Math.floor(s / 3600) + " saat əvvəl";
  if (s < 86400 * 7) return Math.floor(s / 86400) + " gün əvvəl";
  return new Date(t).toLocaleDateString("az", { day: "numeric", month: "short" });
}
export const dateFmt = (sql) => new Date(String(sql).replace(" ", "T") + "Z").toLocaleString("az", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const sym = (id, cls = "", size = 120) => html`<svg class="sym ${cls}" width="${size}" height="${size}" viewBox="0 0 240 240"><use href="img/sprite.svg#${id}"/></svg>`;
export const logo = (size = 34) => html`<svg class="sym" width="${size}" height="${size}" viewBox="0 0 100 100"><use href="img/sprite.svg#brand-mark"/></svg>`;

/* ---------- API ---------- */
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError("Serverlə əlaqə yoxdur", 0); }
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new ApiError((data && data.error) || "Xəta baş verdi", r.status);
  return data;
}
export const get = (u) => api("GET", u);
export const post = (u, b = {}) => api("POST", u, b);
export const put = (u, b) => api("PUT", u, b);
export const patch = (u, b) => api("PATCH", u, b);
export const del = (u) => api("DELETE", u);

/* ---------- toast / modal / confetti ---------- */
export function toast(msg, kind = "") {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .4s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 400); }, 3800);
}
export function modal(tpl, { onClose } = {}) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${tpl.__raw}</div>`;
  const close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) close(); });
  document.body.appendChild(ov);
  const f = ov.querySelector("input,select,textarea,button.btn");
  if (f && window.innerWidth > 700) f.focus();
  return { el: ov.firstChild, close };
}
export function confetti(n = 36) {
  const set = ["🍃", "♻️", "🪙", "✨", "🌱", "⭐"];
  for (let i = 0; i < n; i++) {
    const e = document.createElement("div");
    e.className = "confetti";
    e.textContent = set[i % set.length];
    e.style.left = Math.random() * 100 + "vw";
    e.style.animationDelay = Math.random() * 0.8 + "s";
    e.style.fontSize = 1 + Math.random() * 1.4 + "rem";
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 3800);
  }
}
export function confirmBox(text) {
  return new Promise((res) => {
    const m = modal(html`<h3>${text}</h3><div class="row mt" style="justify-content:flex-end"><button class="btn ghost sm" data-close>Ləğv et</button><button class="btn red sm" id="cf-yes">Bəli</button></div>`, { onClose: () => res(false) });
    m.el.querySelector("#cf-yes").onclick = () => { res(true); m.el.closest(".overlay").remove(); };
  });
}

/* ---------- charts (inline SVG) ---------- */
export function barChart(data, { h = 180, color = "#2ea36f", valueKey = "kg", labelKey = "label", unit = "" } = {}) {
  const w = 560, pad = 26, max = Math.max(1, ...data.map((d) => d[valueKey]));
  const bw = (w - pad * 2) / data.length;
  const bars = data.map((d, i) => {
    const bh = Math.max(2, ((h - 46) * d[valueKey]) / max), x = pad + i * bw + bw * 0.16, y = h - 26 - bh;
    return `<rect x="${x}" y="${y}" width="${bw * 0.68}" height="${bh}" rx="6" fill="${color}"/><text x="${x + bw * 0.34}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#4d6459">${d[valueKey] ? esc(String(Math.round(d[valueKey] * 10) / 10) + unit) : ""}</text><text x="${x + bw * 0.34}" y="${h - 8}" text-anchor="middle" font-size="11" fill="#718a7e">${esc(d[labelKey])}</text>`;
  }).join("");
  return raw(`<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block" role="img">${bars}</svg>`);
}
export function donut(items, { size = 170, center = "", sub = "" } = {}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1, r = 62, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = items.filter((i) => i.value > 0).map((i) => {
    const len = (i.value / total) * c;
    const s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${i.color}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`;
    off += len; return s;
  }).join("");
  return raw(`<svg viewBox="0 0 160 160" width="${size}" height="${size}"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#f2f9f4" stroke-width="22"/>${arcs}<text x="80" y="${sub ? 80 : 86}" text-anchor="middle" font-size="22" font-weight="800" fill="#186644">${esc(center)}</text>${sub ? `<text x="80" y="98" text-anchor="middle" font-size="10" fill="#718a7e">${esc(sub)}</text>` : ""}</svg>`);
}
export const matBars = (byMat, key = "kg", unit = " kq") => {
  const max = Math.max(0.0001, ...MATS.map((m) => byMat[m][key] || 0));
  return html`${MATS.map((m) => html`<div style="margin-bottom:12px"><div class="row between small"><b>${MAT[m].emoji} ${MAT[m].label}</b><span class="muted">${(byMat[m][key] || 0).toLocaleString("az", { maximumFractionDigits: 1 })}${unit}</span></div><div class="bar tall"><i style="width:${((byMat[m][key] || 0) / max) * 100}%;background:${MAT[m].color}"></i></div></div>`)}`;
};

/* ---------- event delegation ---------- */
const handlers = {};
export function on(name, fn) { handlers[name] = fn; }
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = handlers[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const fn = handlers[f.dataset.form];
  if (fn) fn(f, Object.fromEntries(new FormData(f).entries()), e);
});

export const TIPS = [
  "Plastik butulkaları atmazdan əvvəl boşaldıb əzin — məntəqədə daha çox yer qalır.",
  "Kağızı yağdan və yeməkdən təmiz saxlayın — belə kağız təkrar emal olunur.",
  "Şüşə qabları rəngindən asılı olmayaraq məntəqəyə gətirə bilərsiniz.",
  "Hər gün bir əşya belə təhvil versən, seriyan artır və bonus qazanırsan!",
  "1 ton təkrar emal olunmuş kağız təxminən 17 ağacı qoruyur.",
  "EcoCoin-lərini ağacəkmə layihələrinə də bağışlaya bilərsən.",
];
