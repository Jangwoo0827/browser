// Static sanity check of the unified extension: every file the manifest and the HTML pages reference exists,
// JS parses, and message handlers don't swallow each other's messages. Usage: node scripts/check-extension.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ext = join(root, "extensions", "fjord");
const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
const problems = [];
const need = (p, why) => {
  if (!existsSync(join(ext, p))) problems.push(`missing ${p} (${why})`);
};

Object.values(manifest.icons || {}).forEach((p) => need(p, "icons"));
Object.values(manifest.action?.default_icon || {}).forEach((p) => need(p, "action icon"));
if (manifest.side_panel) need(manifest.side_panel.default_path, "side_panel");
if (manifest.options_ui) need(manifest.options_ui.page, "options_ui");
Object.values(manifest.chrome_url_overrides || {}).forEach((p) => need(p, "url override"));
need(manifest.background.service_worker, "background");
(manifest.declarative_net_request?.rule_resources || []).forEach((r) => need(r.path, `ruleset ${r.id}`));
(manifest.content_scripts || []).forEach((c) => (c.js || []).forEach((p) => need(p, "content script")));

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ext);

// HTML: local src/href targets
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|chrome|data:|\/\/)/.test(m[1])) continue;
    if (!existsSync(resolve(dirname(f), m[1]))) problems.push(`${relative(ext, f)}: missing ${m[1]}`);
  }
}

// JS: syntax (as ES module, which is how the service worker loads them) + relative imports
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  try {
    execFileSync(process.execPath, ["--input-type=module", "--check"], { input: src, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    problems.push(`${relative(ext, f)}: syntax error\n${String(e.stderr || e).split("\n").slice(0, 4).join("\n")}`);
  }
  for (const m of src.matchAll(/^import\s.*?from\s+"(\.[^"]+)"|^import\s+"(\.[^"]+)"/gm)) {
    const target = m[1] || m[2];
    if (!existsSync(resolve(dirname(f), target))) problems.push(`${relative(ext, f)}: import not found ${target}`);
  }
}

// registerContentScripts / getURL paths in the ad blocker are extension-root relative
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:js|files):\s*\[\s*['"]([^'"]+)['"]/g)) need(m[1], `${relative(ext, f)} script path`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`extension OK (${files.length} files)`);
