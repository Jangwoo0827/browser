// Copy the stand-alone ad blocker (github.com/Jangwoo0827/adblock, default ../extension/adblock) into the
// unified extension as a module and patch the few extension-root-relative paths.
// Usage: node scripts/sync-adblock.mjs [path-to-adblock-extension]
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeAdblock } from "./localize-adblock.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = resolve(process.argv[2] || join(root, "..", "extension", "adblock"));
const dst = join(root, "extensions", "fjord", "modules", "adblock");

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });
for (const f of ["background.js", "content.js", "popup.html", "popup.js", "scriptlets.js"]) {
  await cp(join(src, f), join(dst, f));
}
await cp(join(src, "rules"), join(dst, "rules"), { recursive: true });

async function patch(file, replacements) {
  const p = join(dst, file);
  let s = await readFile(p, "utf8");
  for (const [from, to] of replacements) {
    if (!s.includes(from)) throw new Error(`${file}: expected text not found: ${from}`);
    s = s.split(from).join(to);
  }
  await writeFile(p, s);
}

// registerContentScripts() paths are relative to the extension root, not to this module
await patch("background.js", [["js: ['scriptlets.js']", "js: ['modules/adblock/scriptlets.js']"]]);
// shared icons live at the extension root
await patch("popup.html", [['src="icons/icon48.png"', 'src="../../icons/icon48.png"']]);
// theme it with the Fjord design tokens (their own variables, our values) so it matches the rest of the panel
const THEME = `  <link rel="stylesheet" href="../../ui/tokens.css">
  <style>
    :root {
      --bg: var(--fj-color-bg-surface); --fg: var(--fj-color-text-primary); --muted: var(--fj-color-text-muted);
      --card: var(--fj-color-bg-canvas); --line: var(--fj-color-border-subtle);
      --accent: var(--fj-color-accent-primary); --accent-2: var(--fj-color-accent-secondary); --accent-soft: var(--fj-color-accent-soft);
      --off: var(--fj-color-border-strong); --warn: var(--fj-color-state-danger);
    }
    body { width: auto; min-width: 280px; font-family: var(--fj-font); }
  </style>
`;
await patch("popup.html", [["</head>", THEME + "</head>"]]);

await localizeAdblock(dst); // Korean popup strings

console.log(`synced ${src} -> ${dst}`);
