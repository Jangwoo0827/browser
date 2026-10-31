// Content script (all frames): a small control strip over videos with playback speed and picture-in-picture, plus the
// keys  ]  [  \  (faster / slower / normal speed) while a video is playing. The strip lives in a closed shadow root.
(() => {
  const MIN_W = 240;
  const MIN_H = 130;
  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';

  let host = null;
  let root = null;
  let strip = null;
  let label = null;
  let video = null;
  let hideTimer = null;

  const fmt = (r) => (Math.round(r * 100) / 100).toString().replace(/\.0+$/, "") + "×";

  function ensureStrip() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0;";
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .strip { position: fixed; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(15,17,21,.82); color: #f6f7f9; font: 600 12px/18px ${FONT}; box-shadow: 0 4px 14px rgba(0,0,0,.4); pointer-events: auto; opacity: 0; transition: opacity 140ms ease; user-select: none; }
      .strip.on { opacity: 1; }
      button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; display: grid; place-items: center; }
      button:hover { background: rgba(255,255,255,.16); }
      .rate { min-width: 46px; text-align: center; cursor: pointer; }
      svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .sep { width: 1px; height: 16px; background: rgba(255,255,255,.2); margin: 0 3px; }
    `;
    strip = document.createElement("div");
    strip.className = "strip";
    const mk = (title, html, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      b.innerHTML = html;
      if (cls) b.className = cls;
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
      return b;
    };
    label = mk("원래 속도로 (\\)", "1×", () => setRate(1), "rate");
    strip.append(
      mk("느리게 ([)", "−", () => bump(-STEP)),
      label,
      mk("빠르게 (])", "+", () => bump(STEP)),
      Object.assign(document.createElement("span"), { className: "sep" }),
      mk("화면 속 화면 (PiP)", '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor"/></svg>', togglePip)
    );
    strip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    root.append(style, strip);
    document.documentElement.append(host);
  }

  function setRate(r) {
    if (!video) return;
    video.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 100) / 100));
    if (label) label.textContent = fmt(video.playbackRate);
  }
  const bump = (d) => video && setRate(video.playbackRate + d);

  async function togglePip() {
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else { video.disablePictureInPicture = false; await video.requestPictureInPicture(); }
    } catch (e) { console.debug("[fjord pip]", e); }
  }

  function show(v) {
    ensureStrip();
    video = v;
    const r = v.getBoundingClientRect();
    strip.style.left = Math.max(6, r.left + 10) + "px";
    strip.style.top = Math.max(6, r.top + 10) + "px";
    label.textContent = fmt(v.playbackRate);
    strip.classList.add("on");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 2600);
  }
  function hide() { strip?.classList.remove("on"); }

  const big = (v) => { const r = v.getBoundingClientRect(); return r.width >= MIN_W && r.height >= MIN_H && r.bottom > 0 && r.right > 0 && r.top < innerHeight; };

  // the pointer is over a video even when the player draws its own layer on top: look through the element stack
  let last = 0;
  document.addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - last < 120) return;
    last = now;
    const v = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.tagName === "VIDEO" && big(el));
    if (v) show(v);
    else if (!(strip && strip.matches(":hover"))) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 600); }
  }, { passive: true });

  // the biggest video that is playing (or the biggest one on the page) gets the speed keys
  function target() {
    const vids = [...document.querySelectorAll("video")].filter(big);
    const playing = vids.filter((v) => !v.paused);
    const pool = playing.length ? playing : vids;
    return pool.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key !== "]" && e.key !== "[" && e.key !== "\\") return;
    const v = target();
    if (!v) return;
    video = v;
    if (e.key === "]") bump(STEP);
    else if (e.key === "[") bump(-STEP);
    else setRate(1);
    show(v);
  }, true);

  window.__fjordVideo = { setRate, bump }; // for tests (isolated world)
})();
