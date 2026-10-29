// Messages from the edge rail (content script on web pages). Only "rail:*" types are handled here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("rail:")) return;

  (async () => {
    if (msg.type === "rail:settings") {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    if (msg.type === "rail:open" && sender.tab) {
      // open() must run while the click's user activation is still valid, so start it before any await
      const opened = chrome.sidePanel.open({ windowId: sender.tab.windowId });
      const { ui } = await chrome.storage.local.get("ui");
      await chrome.storage.local.set({ ui: { collapsed: true, ...(ui || {}), activeId: msg.id } });
      let result;
      try {
        await opened;
        result = { ok: true };
      } catch (e) {
        result = { ok: false, error: String(e) };
      }
      chrome.storage.session.set({ railLast: { at: Date.now(), id: msg.id, ...result } }); // for debugging
      return result;
    }
    return { ok: false };
  })().then(sendResponse);
  return true; // async response
});
