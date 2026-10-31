// Writes QR matrices for a set of strings to logs/qr-cases.json; scripts/test-qr.py decodes them with OpenCV and compares.
// Usage: node scripts/test-qr.mjs && python scripts/test-qr.py
import { writeFileSync, mkdirSync } from "node:fs";
import { qrMatrix } from "../extensions/fjord/ui/qr.js";

const cases = [
  "A", "https://claude.ai/", "https://github.com/Jangwoo0827/browser", "Fjord 브라우저 — 한글도 돼요",
  "https://www.example.com/path/to/some/page?query=" + "x".repeat(20),
  "https://www.example.com/a?" + "token=abcdef0123456789&".repeat(5),
  "https://example.com/" + "segment/".repeat(14),
  "https://example.com/" + "0123456789".repeat(11),
  "https://example.com/?q=" + "abcdefghij".repeat(14),
  "https://example.com/?q=" + "abcdefghij".repeat(17),
  "한글".repeat(40),
  "https://example.com/?q=" + "z".repeat(200),
];
// one text near the top of every version's capacity (level M, byte mode), with different content each
for (const n of [12, 24, 40, 60, 82, 104, 120, 150, 178, 211, 249, 285]) cases.push(("https://example.com/?x=" + Array.from({ length: n }, (_, i) => "abcdefghijklmnopqrstuvwxyz0123456789"[(i * 7 + n) % 36]).join("")).slice(0, n));
mkdirSync("logs", { recursive: true });
writeFileSync("logs/qr-cases.json", JSON.stringify(cases.map((text) => { const m = qrMatrix(text); return { text, version: m.version, mask: m.mask, size: m.size, rows: m.modules.map((r) => r.map((v) => (v ? 1 : 0)).join("")) }; })));
console.log("wrote", cases.length, "cases");
