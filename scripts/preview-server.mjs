// Dev preview: serve extensions/fjord over http://localhost:<port> with a tiny in-memory `chrome.*` stub injected into
// every HTML page, so the extension pages can be opened and screenshotted in a normal browser (no extension host).
// Usage: node scripts/preview-server.mjs [port]
//   /modules/sidebar/panel.html?active=@workspaces   open the panel with a built-in page selected
//   /modules/newtab/newtab.html                       speed dial
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), "extensions", "fjord");
const port = Number(process.argv[2] || 5199);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const STUB = `
(() => {
  const params = new URLSearchParams(location.search);
  const mem = { ui: params.get('active') ? { collapsed: params.get('collapsed') !== '0', activeId: params.get('active') } : undefined };
  if (params.get('collapsed') === '0' && !mem.ui) mem.ui = { collapsed: false, activeId: null };
  const listeners = [];
  const pick = (keys) => {
    if (keys == null) return { ...mem };
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in mem).map((k) => [k, mem[k]]));
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in mem ? mem[k] : d]));
  };
  const cbify = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const p = Promise.resolve(fn(...args));
    if (cb) { p.then(cb); return; }
    return p;
  };
  const WS = [
    { id: 'personal', name: '개인', color: 'blue', count: 7 },
    { id: 'work', name: '업무', color: 'orange', count: 12 },
    { id: 'school', name: '학교', color: 'green', count: 3 },
  ];
  window.chrome = {
    storage: {
      local: {
        get: cbify((k) => pick(k)),
        set: cbify((o) => { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { newValue: v }; mem[k] = v; } listeners.forEach((l) => l(ch, 'local')); }),
      },
      session: { get: cbify(() => ({ active: { 1: 'personal' } })), set: cbify(() => {}) },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
    runtime: {
      id: 'preview',
      lastError: undefined,
      getURL: (p) => '/' + p,
      openOptionsPage: () => { location.href = '/modules/sidebar/options.html'; },
      sendMessage: cbify((msg) => {
        if (msg && msg.type === 'ws:state') return { workspaces: WS, activeId: 'personal' };
        if (msg && msg.type === 'isUpdating') return { updating: false };
        return {};
      }),
    },
    windows: { getCurrent: cbify(() => ({ id: 1 })) },
    tabs: { create: ({ url }) => window.open(url, '_blank'), query: cbify(() => [{ id: 1, url: 'https://claude.ai/chat', active: true }]), reload: () => {} },
    search: { query: () => {} },
    management: { get: cbify(() => { throw new Error('not installed'); }) },
  };
  // the ad blocker popup reads chrome.storage.local with callbacks and expects stats/meta defaults
  mem.stats = { network: 128, cosmetic: 41, youtube: 3 };
  mem.meta = { updated: Date.now(), network: 52340, cosmetic: 9120 };
})();
`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path === "/__stub.js") {
      res.writeHead(200, { "content-type": TYPES[".js"] });
      return res.end(STUB);
    }
    if (path === "/") path = "/modules/sidebar/panel.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error("outside root");
    let body = await readFile(file);
    const type = TYPES[extname(file)] || "application/octet-stream";
    if (extname(file) === ".html") body = Buffer.from(body.toString("utf8").replace(/<head>/i, '<head><script src="/__stub.js"></script>'));
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${port}/`));
