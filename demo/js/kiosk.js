import { html, raw, mount, $, on, sym, logo, MAT, MATS, fmt, fmtDec, fmtKg, esc, confetti } from "./core.js";

const LS = "ecopoint.kiosk";
let cred = null, state = null, sess = null, count = 1, stream = null, scanTimer = null, lastAct = Date.now(), poll = null, idleT = null, muted = false, last = null, busy = false;
const root = $("#k");

/* ---------- credentials ---------- */
try { cred = JSON.parse(localStorage.getItem(LS) || "null"); } catch { cred = null; }
if (location.hash.includes("key=")) {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("id") && p.get("key")) { cred = { id: p.get("id"), key: p.get("key") }; localStorage.setItem(LS, JSON.stringify(cred)); }
  history.replaceState(null, "", location.pathname);
}
async function kapi(method, url, body) {
  const r = await fetch(url, { method, headers: { "x-station-id": cred.id, "x-station-key": cred.key, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Xəta"); e.status = r.status; throw e; }
  return d;
}

/* ---------- audio ---------- */
let ac = null;
function audio() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* none */ } } if (ac && ac.state === "suspended") ac.resume(); return ac; }
function noise(dur, { f = 2000, q = 1, type = "bandpass", gain = 0.4, at = 0, sweep = 0 } = {}) {
  const c = audio(); if (!c || muted) return;
  const n = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(); s.buffer = n;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  if (sweep) fl.frequency.exponentialRampToValueAtTime(Math.max(50, f * sweep), c.currentTime + at + dur);
  const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime + at); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
  s.connect(fl); fl.connect(g); g.connect(c.destination); s.start(c.currentTime + at);
}
function tone(freq, dur, { type = "sine", gain = 0.2, at = 0, end = null } = {}) {
  const c = audio(); if (!c || muted) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + at);
  if (end) o.frequency.exponentialRampToValueAtTime(end, c.currentTime + at + dur);
  g.gain.setValueAtTime(gain, c.currentTime + at); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
  o.connect(g); g.connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05);
}
const SFX = {
  plastik: () => { for (let i = 0; i < 5; i++) noise(0.07, { f: 3000 + Math.random() * 2500, q: 2, gain: 0.35, at: i * 0.055 }); },
  kagiz: () => { noise(0.45, { f: 1800, q: 0.6, type: "lowpass", gain: 0.5, sweep: 0.4 }); noise(0.25, { f: 5000, q: 0.5, type: "highpass", gain: 0.12, at: 0.05 }); },
  shushe: () => { [2637, 3951, 3136].forEach((f, i) => tone(f, 0.5, { type: "triangle", gain: 0.18, at: i * 0.07 })); noise(0.08, { f: 6500, q: 3, gain: 0.3 }); },
  metal: () => { [220, 349, 556, 931].forEach((f) => tone(f, 0.8, { type: "square", gain: 0.05 })); noise(0.1, { f: 900, q: 4, gain: 0.5 }); },
  coin: () => { tone(1568, 0.5, { type: "sine", gain: 0.2 }); tone(2093, 0.7, { type: "sine", gain: 0.18, at: 0.1 }); },
  err: () => { tone(220, 0.25, { type: "sawtooth", gain: 0.12 }); tone(165, 0.3, { type: "sawtooth", gain: 0.12, at: 0.18 }); },
  ok: () => { [523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: "triangle", gain: 0.16, at: i * 0.1 })); },
};
function speak(text) {
  if (muted || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => /^az/i.test(x.lang)) || vs.find((x) => /^tr/i.test(x.lang));
    u.lang = v ? v.lang : "tr-TR"; if (v) u.voice = v; u.rate = 1; u.pitch = 1.1;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/* ---------- rendering ---------- */
const miniBins = () => html`<div class="mini">${state.bins.map((b) => html`<div><div class="vb"><i style="height:${Math.max(3, b.pct)}%;${b.pct >= 85 ? "background:#e58a7a" : ""}"></i></div>${MAT[b.material].emoji} ${b.pct}%</div>`)}</div>`;
let adI = 0;
function header() {
  return html`<div class="khead"><span class="brand">${logo(40)}<span style="font-size:1.4rem">Eco<b>Point</b></span></span>
    <div class="st">${state ? state.station.name : "Məntəqə"}<small>${state ? state.station.address : ""}</small></div>
    <button class="kbtn g" style="padding:10px 16px" data-act="mute" title="Səs">${muted ? "🔇" : "🔊"}</button></div>`;
}
function setup(err = "") {
  mount(root, html`<div class="kwrap"><div class="ksetup kcard"><div class="center">${logo(60)}</div><h2 class="center mt">Məntəqə ekranını aktivləşdir</h2><p class="center mb">Administrator panelindəki məntəqə nömrəsini və kiosk açarını daxil et.</p>
    ${err ? html`<div class="err">${err}</div>` : ""}
    <form data-form="setup"><div class="field"><label style="color:#fff">Məntəqə nömrəsi</label><input type="number" name="id" min="1" required></div><div class="field"><label style="color:#fff">Kiosk açarı</label><input type="password" name="key" required autocomplete="off"></div><button class="kbtn" style="width:100%" type="submit">Aktivləşdir</button></form>
    <p class="center small mt"><a href="./" style="color:var(--gold)">← Tətbiqə qayıt</a></p></div></div>`);
}
on("setup", async (f, d) => {
  cred = { id: String(d.id), key: d.key.trim() };
  try { state = await kapi("GET", "/api/kiosk/state"); localStorage.setItem(LS, JSON.stringify(cred)); idle(); }
  catch (e) { cred = null; setup(e.message); }
});
on("mute", () => { muted = !muted; if (muted) speechSynthesis && speechSynthesis.cancel(); else audio(); (sess ? active : idle)(); });
on("reset-k", () => { localStorage.removeItem(LS); cred = null; stopCam(); setup(); });

function idle(msg = "") {
  stopCam(); sess = null; last = null; clearInterval(idleT);
  const ad = state.ads.length ? state.ads[adI % state.ads.length] : null;
  mount(root, html`<div class="kwrap">${header()}
  <div class="kmain">
    <div class="kcard col" style="justify-content:center">
      <div class="row" style="gap:22px"><div class="bob" style="flex-shrink:0">${sym("tosbik-wave", "", 150)}</div><div><div class="kbig">Salam! 👋<br>Tullantını dəyərə çevir.</div></div></div>
      <p style="font-size:1.15rem">Tətbiqdəki <b>QR kodunu</b> kameraya göstər və ya kodu aşağıya daxil et.</p>
      ${msg ? html`<div class="err">${msg}</div>` : ""}
      <div id="camwrap"></div>
      <div class="row wrap"><button class="kbtn" data-act="cam">📷 Kameranı aç</button></div>
      <form class="kinput" data-form="code"><input type="text" name="code" placeholder="KOD" maxlength="12" autocomplete="off" autocapitalize="characters"><button class="kbtn" type="submit">Daxil ol</button></form>
    </div>
    <div class="kcard">
      <div class="kscreen"><div><div style="font-size:1.6rem">♻️ EcoPoint</div><div style="font-size:.95rem;font-weight:600;margin-top:6px">QR kodu oxutmağı gözləyir…</div></div></div>
      <h3 style="margin-top:22px">Bölmələrin doluluğu</h3>${miniBins()}
      <div class="stat4">${MATS.map((m) => html`<div><b>+${state.rates[m].coins}</b><span>${MAT[m].emoji} ${MAT[m].label} / əşya</span></div>`)}</div>
      ${ad ? html`<div class="ad" id="ad"><span style="font-size:1.8rem">${ad.emoji}</span><span>${ad.text}</span></div>` : ""}
    </div>
  </div>
  <div class="small" style="margin-top:14px;color:rgba(255,255,255,.5)"><a href="#" data-act="reset-k" style="color:inherit">Konfiqurasiya</a> · <a href="./" style="color:inherit">Tətbiq</a></div></div>`);
}
on("cam", async () => { audio(); await startCam(); });
on("code", (f, d) => { audio(); identify(d.code); });

async function identify(code) {
  if (busy) return; busy = true;
  try {
    const r = await kapi("POST", "/api/kiosk/identify", { code });
    sess = r; count = 1; lastAct = Date.now(); last = null;
    SFX.ok(); speak("Xoş gəldiniz, " + r.user.first + "!");
    active();
    clearInterval(idleT); idleT = setInterval(() => { const left = 90 - Math.round((Date.now() - lastAct) / 1000); const el = $("#cd"); if (el) el.textContent = Math.max(0, left) + " san"; if (left <= 0) finish(); }, 1000);
  } catch (e) { SFX.err(); idle(e.message); }
  busy = false;
}

function active() {
  stopCam();
  const u = sess.user;
  mount(root, html`<div class="kwrap">${header()}
  <div class="kmain">
    <div class="kcard">
      <div class="row between wrap"><div><div class="kbig" style="font-size:2.2rem">Salam, ${u.first}! 🌟</div><div class="small" style="opacity:.8">${u.level.emoji} ${u.level.name} · 🔥 ${u.streak} gün</div></div><div class="right"><div class="small" style="opacity:.8">Balans</div><b style="font-size:1.8rem;color:var(--gold)" id="kbal">${fmt(u.coins)} EC</b></div></div>
      <div class="stepper"><button data-act="dec">−</button><b id="cnt">${count}</b><button data-act="inc">+</button></div>
      <p class="center small" style="margin-top:-8px">Əşya sayını seç, sonra tullantının növünü bas (hər basış = ${count} əşya atmaq)</p>
      <div class="mats mt">${state.bins.map((b) => { const cl = { plastik: "pl", kagiz: "ka", shushe: "sh", metal: "me" }[b.material]; return html`<button class="mat ${cl}" data-act="drop" data-m="${b.material}" ${b.full ? "disabled" : ""}><div class="e">${MAT[b.material].emoji}</div><div class="l">${MAT[b.material].label}</div><div class="r">${b.full ? "Bölmə dolub" : "+" + state.rates[b.material].coins + " EC / əşya"}</div><div class="f" style="width:${b.pct}%"></div></button>`; })}</div>
    </div>
    <div class="kcard">
      <div class="kscreen"><div id="kscr">${last ? html`<div class="lastres"><div style="font-size:2.4rem;color:#fde5a6">+${last.total} EcoCoin</div><div style="font-size:1rem;font-weight:600;margin-top:6px">${last.message}</div>${last.bonus ? html`<div class="chip gold mt">🔥 Gündəlik bonus +${last.bonus}</div>` : ""}</div>` : html`<div style="font-size:1.4rem">Tullantını növünə görə seç ♻️</div>`}</div></div>
      ${last && last.achievements.length ? html`<div class="ad">${last.achievements.map((a) => html`<span>${a.emoji} ${a.title}</span>`)}</div>` : ""}
      ${last && last.levelUp ? html`<div class="ad">🎉 Yeni səviyyə: ${last.level.emoji} ${last.level.name}</div>` : ""}
      <h3 style="margin-top:22px">Ekoloji statistika</h3>
      <div class="stat4"><div><b>${fmtDec(sess.stats.kg + (sess.stats.add || 0))}</b><span>kq təhvil (ümumi)</span></div><div><b>${fmtDec(sess.stats.impact.co2)}</b><span>kq CO₂ qənaəti</span></div><div><b id="sitems">${fmt(sess.items || 0)}</b><span>bu sessiyada əşya</span></div><div><b id="scoins">+${fmt(sess.earned || 0)}</b><span>bu sessiyada EcoCoin</span></div></div>
      <div class="row between" style="margin-top:22px"><span class="small" style="opacity:.7">Avtomatik çıxış: <b class="cdn" id="cd">90 san</b></span><button class="kbtn" data-act="finish">✓ Bitir</button></div>
    </div>
  </div></div>`);
}
on("inc", () => { count = Math.min(20, count + 1); lastAct = Date.now(); $("#cnt").textContent = count; });
on("dec", () => { count = Math.max(1, count - 1); lastAct = Date.now(); $("#cnt").textContent = count; });
on("drop", async (b) => {
  if (busy) return; busy = true; lastAct = Date.now(); audio();
  const m = b.dataset.m;
  const e = document.createElement("div"); e.className = "drop"; e.textContent = MAT[m].emoji; e.style.left = "50%"; e.style.top = "35%"; document.body.appendChild(e); setTimeout(() => e.remove(), 1000);
  SFX[m]();
  try {
    const r = await kapi("POST", "/api/kiosk/deposit", { sessionId: sess.sessionId, material: m, items: count });
    last = r; state.bins = r.bins;
    sess.user.coins = r.balance; sess.user.streak = r.streak; sess.user.level = r.level;
    sess.items = (sess.items || 0) + r.items; sess.earned = (sess.earned || 0) + r.total;
    const wkg = r.items * state.rates[m].kg; sess.stats.add = (sess.stats.add || 0) + wkg; sess.stats.impact.co2 = +(sess.stats.impact.co2 + wkg * state.rates[m].co2).toFixed(2);
    setTimeout(() => { SFX.coin(); speak(r.message.replace("+", "plus ")); confetti(8); }, 450);
    active();
  } catch (er) {
    SFX.err();
    if (er.status === 410) { idle("Sessiya başa çatdı. Yenidən QR oxut."); busy = false; return; }
    if (er.status === 409) { try { state = await kapi("GET", "/api/kiosk/state"); } catch { /* ignore */ } active(); }
    const scr = $("#kscr"); if (scr) mount(scr, html`<div><div style="font-size:1.4rem">⚠ ${er.message}</div></div>`);
  }
  busy = false;
});
async function finish() {
  clearInterval(idleT);
  const s = sess; if (!s) return;
  try { await kapi("POST", "/api/kiosk/finish", { sessionId: s.sessionId }); } catch { /* ignore */ }
  const items = s.items || 0, earned = s.earned || 0;
  sess = null;
  mount(root, html`<div class="kwrap">${header()}<div class="kcard center" style="max-width:640px;margin:6vh auto"><div class="bob" style="width:170px;margin:0 auto">${sym("tosbik-happy", "", 170)}</div><div class="kbig mt">Təşəkkür edirik, ${s.user.first}! 💚</div><p style="font-size:1.2rem" class="mt">${items ? `Bu gün ${items} əşya təhvil verdin və ${earned} EcoCoin qazandın.` : "Növbəti dəfə görüşərik!"}</p><p>Mükafatlarını tətbiqdə gör.</p><div class="small" style="opacity:.6">Ekran avtomatik bağlanacaq…</div></div></div>`);
  if (items) { speak("Təşəkkürlər! Planet üçün bir addım daha."); confetti(24); }
  setTimeout(() => { refresh().then(() => idle()); }, 5000);
}
on("finish", () => finish());

/* ---------- camera ---------- */
async function startCam() {
  const w = $("#camwrap");
  if (!navigator.mediaDevices || !window.jsQR) { mount(w, html`<div class="err">Kamera bu brauzerdə mövcud deyil. Kodu əl ilə daxil et.</div>`); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch { mount(w, html`<div class="err">Kameraya icazə verilmədi. Kodu əl ilə daxil et.</div>`); return; }
  mount(w, html`<div class="cam"><video playsinline muted></video></div>`);
  const v = $("video", w); v.srcObject = stream; await v.play().catch(() => {});
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
  scanTimer = setInterval(() => {
    if (!v.videoWidth || busy) return;
    const sc = 480 / v.videoWidth; cv.width = 480; cv.height = Math.round(v.videoHeight * sc);
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (res && /^EP:[A-Z0-9]{8}$/.test(res.data)) { clearInterval(scanTimer); identify(res.data); }
  }, 150);
}
function stopCam() { clearInterval(scanTimer); if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

async function refresh() { try { state = await kapi("GET", "/api/kiosk/state"); } catch (e) { if (e.status === 401) { localStorage.removeItem(LS); cred = null; setup("Açar etibarsızdır. Yenidən daxil et."); throw e; } } }
(async () => {
  if (!cred) return setup();
  try { await refresh(); idle(); } catch { return; }
  poll = setInterval(async () => { if (sess || busy) return; try { await refresh(); adI++; const ci = $('input[name=code]'); if (!$("#camwrap video") && !(ci && (ci.value || document.activeElement === ci))) idle(); } catch { /* ignore */ } }, 12000);
})();
if ("speechSynthesis" in window) speechSynthesis.getVoices();
