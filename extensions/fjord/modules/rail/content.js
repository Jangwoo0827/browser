// Content script: draw the Fjord rail on the edge of ordinary web pages (top frame only). The rail module is an
// ES module, so it is loaded with a dynamic import (web_accessible_resources). Everything lives in a closed shadow root.
(async () => {
  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol) || document.contentType !== "text/html") return;

  const base = chrome.runtime.getURL("modules/rail/");
  const { loadSettings, mountRail } = await import(base + "rail.js");

  const WIDTH = 48; // --fj-size-rail-collapsed
  let host = null;
  let handle = null;
  let shownSide = null;

  function clearPush() {
    for (const side of ["left", "right"]) document.documentElement.style.removeProperty("margin-" + side);
  }

  function unmount() {
    handle?.destroy();
    host?.remove();
    host = handle = shownSide = null;
    clearPush();
  }

  async function mount(settings) {
    unmount();
    host = document.createElement("div");
    host.id = "fjord-rail-host";
    host.style.cssText = "all: initial";
    const root = host.attachShadow({ mode: "closed" });
    for (const href of ["ui/tokens.css", "ui/base.css", "modules/rail/rail.css"]) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL(href);
      root.append(link);
    }
    handle = await mountRail(root, {
      side: settings.side,
      open: (id) => chrome.runtime.sendMessage({ type: "rail:open", id }),
      workspace: (id) => chrome.runtime.sendMessage({ type: "ws:switch", id }),
      settings: () => chrome.runtime.sendMessage({ type: "rail:settings" }),
    });
    document.documentElement.append(host);
    shownSide = settings.side;
    // make room instead of covering the page's own edge
    document.documentElement.style.setProperty("margin-" + settings.side, WIDTH + "px", "important");
  }

  async function refresh() {
    const settings = await loadSettings();
    if (!settings.enabled) return unmount();
    if (!host || shownSide !== settings.side) await mount(settings);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.railSettings) refresh();
    else if ((changes.items || changes.workspaces || changes.wsActive) && host) loadSettings().then(mount); // sites / workspaces changed: redraw
  });

  await refresh();
})().catch((e) => console.debug("[fjord rail]", e));
