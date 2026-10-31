// Content script (top frame): reader mode, region screenshot selection, full-page screenshot helpers and short toasts.
// Everything it draws lives in a closed shadow root. It answers "tools:*" messages from modules/tools/background.js.
(() => {
  if (window.top !== window) return;

  // ---------------------------------------------------------------- shared
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 3; max-width: 80vw; padding: 10px 18px; border-radius: 999px; background: #1f2937; color: #f6f7f9; font: 500 14px/20px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  `;

  function makeHost(id, css) {
    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE + (css || "");
    root.append(style);
    return { host, root };
  }

  let toastHost = null;
  let toastTimer = null;
  function toast(text) {
    toastHost?.remove();
    clearTimeout(toastTimer);
    const { host, root } = makeHost("fjord-toast");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    root.append(el);
    document.documentElement.append(host);
    toastHost = host;
    toastTimer = setTimeout(() => host.remove(), 2800);
  }

  // ---------------------------------------------------------------- reader mode
  const NOISE = "script,style,noscript,nav,aside,footer,header,form,iframe,button,input,select,textarea,svg,canvas,dialog,[role=navigation],[role=banner],[role=complementary],[aria-hidden=true],.ad,.ads,.advert,.sidebar,.comments,.comment,.share,.social,.related,.newsletter,.popup,.modal,.cookie";

  const textLen = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().length;
  const linkLen = (el) => [...el.querySelectorAll("a")].reduce((n, a) => n + textLen(a), 0);

  // choose the element that holds the most running text (paragraphs), penalising link-heavy blocks
  function pickContainer(doc) {
    const seeds = [...doc.querySelectorAll("article, main, [role=main], [itemprop=articleBody], .post-content, .entry-content, .article-body, .article, .post, #content, #main")];
    seeds.push(doc.body);
    let best = null;
    let bestScore = 0;
    for (const el of seeds) {
      const paras = [...el.querySelectorAll("p")].filter((p) => !p.closest("nav,aside,footer,header,form"));
      const text = paras.reduce((n, p) => n + Math.max(0, textLen(p) - linkLen(p) * 1.5), 0);
      const score = text * (el === doc.body ? 0.85 : 1);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best ? { el: best, score: bestScore } : null;
  }

  function absolutize(node, base) {
    for (const [attr, tag] of [["href", "a"], ["src", "img"], ["src", "source"]]) {
      node.querySelectorAll(tag).forEach((el) => {
        const v = el.getAttribute(attr);
        if (v) try { el.setAttribute(attr, new URL(v, base).href); } catch {}
      });
    }
    node.querySelectorAll("img").forEach((img) => {
      const lazy = img.getAttribute("data-src") || img.getAttribute("data-original");
      if (lazy && !img.getAttribute("src")) try { img.setAttribute("src", new URL(lazy, base).href); } catch {}
    });
  }

  function extractArticle(doc = document) {
    const picked = pickContainer(doc);
    if (!picked || picked.score < 250) return null; // not an article-like page
    const copy = picked.el.cloneNode(true);
    copy.querySelectorAll(NOISE).forEach((n) => n.remove());
    absolutize(copy, doc.baseURI);
    for (const el of copy.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) if (!["href", "src", "alt", "title", "colspan", "rowspan"].includes(attr.name)) el.removeAttribute(attr.name);
      if (el.tagName === "A") el.setAttribute("target", "_blank"), el.setAttribute("rel", "noopener noreferrer");
    }
    const meta = (sel) => doc.querySelector(sel)?.getAttribute("content") || "";
    const title = meta('meta[property="og:title"]') || doc.querySelector("h1")?.textContent?.trim() || doc.title;
    copy.querySelectorAll("h1").forEach((h1) => { if (h1.textContent.trim() === title.trim()) h1.remove(); });
    return {
      title: title.trim(),
      byline: meta('meta[name="author"]') || doc.querySelector('[rel="author"], .author, .byline')?.textContent?.trim() || "",
      site: meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, ""),
      html: copy.innerHTML,
      minutes: Math.max(1, Math.round(textLen(copy) / 500)), // Korean reads ~500 characters a minute
    };
  }

  const READER_CSS = `
    .wrap { position: fixed; inset: 0; z-index: 2; overflow-y: auto; pointer-events: auto; background: var(--bg); color: var(--fg); font-family: var(--font); }
    .bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: var(--bg); border-bottom: 1px solid var(--line); font: 500 13px/18px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; }
    .bar .grow { flex: 1; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .bar button { height: 32px; min-width: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font: inherit; cursor: pointer; }
    .bar button:hover { background: var(--hover); }
    .bar button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
    .bar .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
    .reader { max-width: var(--width); margin: 0 auto; padding: 36px 24px 120px; font-size: var(--size); line-height: 1.85; }
    .reader h1.title { margin: 0 0 8px; font-size: 1.7em; line-height: 1.35; }
    .reader .meta { margin: 0 0 32px; color: var(--muted); font: 400 14px/20px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif; }
    .reader p, .reader li { margin: 0 0 1.1em; }
    .reader img, .reader video { max-width: 100%; height: auto; border-radius: 8px; }
    .reader figure { margin: 1.4em 0; }
    .reader figcaption { color: var(--muted); font-size: .85em; }
    .reader blockquote { margin: 1.2em 0; padding: 0 0 0 1em; border-left: 3px solid var(--line); color: var(--muted); }
    .reader pre, .reader code { font: 13.5px/1.6 ui-monospace, Consolas, monospace; background: var(--hover); border-radius: 6px; }
    .reader pre { padding: 12px 14px; overflow-x: auto; } .reader code { padding: 1px 5px; }
    .reader a { color: var(--accent); }
    .reader table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; } .reader td, .reader th { border: 1px solid var(--line); padding: 6px 10px; }
  `;
  const THEMES = {
    light: "--bg:#fbfbfa;--fg:#1d1f24;--muted:#6b7280;--line:#e3e5ea;--hover:#eceef2;--accent:#4f52e0",
    sepia: "--bg:#f4ecd8;--fg:#3b2f1e;--muted:#7a6a52;--line:#dccfae;--hover:#eadfc4;--accent:#8a4b12",
    dark: "--bg:#16181d;--fg:#e6e8ee;--muted:#9aa1ad;--line:#2d3037;--hover:#262930;--accent:#9aa5ff",
  };
  const FONTS = { sans: 'Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif', serif: '"Noto Serif KR", "Batang", Georgia, serif' };
  const DEFAULT_PREFS = { theme: "light", font: "sans", size: 19, width: 720 };

  let readerHost = null;
  let savedOverflow = "";

  function closeReader() {
    readerHost?.remove();
    readerHost = null;
    document.documentElement.style.overflow = savedOverflow;
  }

  async function openReader() {
    if (readerHost) return closeReader();
    const article = extractArticle();
    if (!article) return toast("이 페이지는 리더 모드로 읽기 어려워요");
    const { readerPrefs } = await chrome.storage.local.get("readerPrefs");
    const prefs = { ...DEFAULT_PREFS, ...(readerPrefs || {}) };
    const { host, root } = makeHost("fjord-reader", READER_CSS);
    host.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const apply = () => {
      wrap.style.cssText = `${THEMES[prefs.theme] || THEMES.light};--font:${FONTS[prefs.font] || FONTS.sans};--size:${prefs.size}px;--width:${prefs.width}px`;
      chrome.storage.local.set({ readerPrefs: prefs });
      bar.querySelectorAll("[data-pref]").forEach((b) => b.setAttribute("aria-pressed", String(String(prefs[b.dataset.pref]) === b.dataset.value)));
    };
    const btn = (label, title, onClick, pref, value) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.type = "button";
      if (pref) { b.dataset.pref = pref; b.dataset.value = String(value); }
      b.onclick = onClick;
      return b;
    };
    const bar = document.createElement("div");
    bar.className = "bar";
    const info = Object.assign(document.createElement("span"), { className: "grow", textContent: `${article.site} · 약 ${article.minutes}분` });
    const set = (k, v) => () => { prefs[k] = v; apply(); };
    const step = (k, d, min, max) => () => { prefs[k] = Math.max(min, Math.min(max, prefs[k] + d)); apply(); };
    const sep = () => Object.assign(document.createElement("span"), { className: "sep" });
    bar.append(
      info,
      btn("가−", "글자 작게", step("size", -2, 14, 30)), btn("가+", "글자 크게", step("size", 2, 14, 30)), sep(),
      btn("고딕", "고딕체", set("font", "sans"), "font", "sans"), btn("명조", "명조체", set("font", "serif"), "font", "serif"), sep(),
      btn("좁게", "좁은 폭", set("width", 600), "width", 600), btn("보통", "보통 폭", set("width", 720), "width", 720), btn("넓게", "넓은 폭", set("width", 920), "width", 920), sep(),
      btn("밝게", "밝은 테마", set("theme", "light"), "theme", "light"), btn("세피아", "세피아", set("theme", "sepia"), "theme", "sepia"), btn("어둡게", "어두운 테마", set("theme", "dark"), "theme", "dark"), sep(),
      btn("읽기 목록", "읽기 목록에 추가", async () => { const r = await chrome.runtime.sendMessage({ type: "tools:reading-add" }); toast(r?.ok ? "읽기 목록에 추가했어요" : "추가하지 못했어요"); }),
      btn("닫기 ✕", "닫기 (Esc)", closeReader)
    );

    const art = document.createElement("div");
    art.className = "reader"; // a class, not the tag: the extracted body may itself contain an <article>
    const h1 = Object.assign(document.createElement("h1"), { className: "title", textContent: article.title });
    const meta = Object.assign(document.createElement("p"), { className: "meta", textContent: article.byline ? `${article.byline} · ${article.site}` : article.site });
    const body = document.createElement("div");
    body.innerHTML = article.html; // already stripped of scripts, handlers and styles above
    art.append(h1, meta, body);
    wrap.append(bar, art);
    root.append(wrap);
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.append(host);
    readerHost = host;
    apply();
    wrap.tabIndex = -1;
    wrap.focus();
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") closeReader(); });
  }

  // ---------------------------------------------------------------- region selection
  function selectRegion() {
    return new Promise((resolve) => {
      const { host, root } = makeHost("fjord-region", `
        .veil { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: rgba(8,9,20,.35); }
        .box { position: fixed; border: 2px solid #818cf8; background: rgba(129,140,248,.14); box-shadow: 0 0 0 100vmax rgba(8,9,20,.35); }
        .tip { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; background: #1f2937; color: #f6f7f9; font: 500 13px/18px Pretendard, "Noto Sans KR", system-ui, sans-serif; }
      `);
      const veil = document.createElement("div");
      veil.className = "veil";
      const tip = Object.assign(document.createElement("div"), { className: "tip", textContent: "드래그해서 영역을 고르세요 · Esc 취소" });
      root.append(veil, tip);
      document.documentElement.append(host);
      let box = null;
      let start = null;
      const done = (rect) => { host.remove(); document.removeEventListener("keydown", onKey, true); resolve(rect); };
      const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
      document.addEventListener("keydown", onKey, true);
      veil.onmousedown = (e) => { start = { x: e.clientX, y: e.clientY }; veil.style.background = "transparent"; box = document.createElement("div"); box.className = "box"; root.append(box); };
      veil.onmousemove = (e) => {
        if (!start) return;
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
        Object.assign(box.style, { left: x + "px", top: y + "px", width: Math.abs(e.clientX - start.x) + "px", height: Math.abs(e.clientY - start.y) + "px" });
      };
      veil.onmouseup = (e) => {
        if (!start) return;
        const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
        done(rect.w > 8 && rect.h > 8 ? rect : null);
      };
    });
  }

  // ---------------------------------------------------------------- full-page capture helpers
  let hidden = [];
  function hideFixed() { // fixed / sticky bars would repeat in every strip
    hidden = [];
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") { hidden.push([el, el.style.visibility]); el.style.visibility = "hidden"; }
    }
  }
  function restoreFixed() { for (const [el, v] of hidden) el.style.visibility = v; hidden = []; }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "tools:reader": openReader().then(() => sendResponse({ ok: true })); return true;
      case "tools:toast": toast(msg.text); sendResponse({ ok: true }); return;
      case "tools:region": selectRegion().then((rect) => sendResponse({ rect, dpr: window.devicePixelRatio })); return true;
      case "tools:metrics": sendResponse({ height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), viewport: window.innerHeight, width: window.innerWidth, dpr: window.devicePixelRatio, y: window.scrollY }); return;
      case "tools:scrollto": window.scrollTo(0, msg.y); setTimeout(() => sendResponse({ y: window.scrollY }), 220); return true;
      case "tools:hide-fixed": hideFixed(); sendResponse({ ok: true }); return;
      case "tools:restore": restoreFixed(); window.scrollTo(0, msg.y || 0); sendResponse({ ok: true }); return;
      case "tools:print": window.print(); sendResponse({ ok: true }); return;
      default: return;
    }
  });

  window.__fjordReader = { extractArticle }; // for tests (isolated world: not visible to the page)
})();
