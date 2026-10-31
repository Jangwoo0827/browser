// Content script: shows the quick find box on ordinary web pages when the background asks for it (Ctrl+Shift+K).
// The UI is an ES module, loaded lazily with a dynamic import (web_accessible_resources) into a closed shadow root.
(() => {
  if (window.top !== window) return;
  let host = null;
  let handle = null;

  function close() {
    handle?.destroy();
    host?.remove();
    host = handle = null;
  }

  async function open() {
    if (host) return handle?.focus();
    host = document.createElement("div");
    host.id = "fjord-quick-host";
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    for (const href of ["ui/tokens.css", "ui/base.css", "modules/quick/quick.css"]) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL(href);
      root.append(link);
    }
    const { mountQuick } = await import(chrome.runtime.getURL("modules/quick/ui.js"));
    handle = mountQuick(root, { close, inPage: true });
    document.documentElement.append(host);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "quick:toggle") return;
    if (host) close();
    else open().catch((e) => console.debug("[fjord quick]", e));
    sendResponse({ ok: true });
  });
})();
