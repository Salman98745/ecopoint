"use strict";
// Builds the static, serverless demo into ../demo (served by GitHub Pages at /demo/).
const fs = require("fs"), path = require("path");
const SRC = path.join(__dirname, "public"), OUT = path.join(__dirname, "..", "demo");
fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
(function walk(d, rel = "") { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, path.join(rel, f)) : copy(p, path.join(OUT, rel, f)); } })(SRC);
copy(path.join(__dirname, "node_modules/jsqr/dist/jsQR.js"), path.join(OUT, "vendor/jsQR.js"));
copy(path.join(__dirname, "node_modules/qrcode-generator/dist/qrcode.js"), path.join(OUT, "vendor/qrcode.js"));
copy(path.join(__dirname, "demo/demo-backend.js"), path.join(OUT, "js/demo-backend.js"));
const inject = '<script src="vendor/qrcode.js"></script>\n<script src="js/demo-backend.js"></script>\n';
for (const f of ["index.html", "kiosk.html"]) {
  const p = path.join(OUT, f);
  let h = fs.readFileSync(p, "utf8");
  h = h.replace(/(<script[^>]*src="(?:js\/app\.js|js\/kiosk\.js)")/, (m) => inject + m);
  h = h.replace("<title>", "<title>[Demo] ");
  fs.writeFileSync(p, h);
}
console.log("demo built →", OUT);
