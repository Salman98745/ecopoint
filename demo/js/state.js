import { get, $, fmt } from "./core.js";
export const S = { user: null, cfg: null, es: null };
export async function loadMe() { const r = await get("/api/me"); S.user = r.user; return S.user; }
export async function loadCfg() { if (!S.cfg) S.cfg = await get("/api/config"); return S.cfg; }
export function setCoins(n) { if (S.user) S.user.coins = n; const el = $("#coinbal"); if (el) el.textContent = fmt(n); }
