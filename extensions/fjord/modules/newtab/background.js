// The first tab of a launch is opened before extensions finish loading, so it ends up on the stock
// new tab page or on a "blocked" error for our own page. Once per browser session, move such tabs to the speed dial.
const NEWTAB = chrome.runtime.getURL("modules/newtab/newtab.html");
const LOOSE = [/^about:blank$/, /^chrome:\/\/newtab\/?$/, /^chrome:\/\/new-tab-page/, /^chrome-search:\/\/local-ntp/];

async function fixStartupTabs() {
  const { startupFixed } = await chrome.storage.session.get("startupFixed");
  if (startupFixed) return;
  await chrome.storage.session.set({ startupFixed: true });

  for (const tab of await chrome.tabs.query({})) {
    const url = tab.url || tab.pendingUrl || "";
    if (url === NEWTAB) chrome.tabs.reload(tab.id);
    else if (LOOSE.some((re) => re.test(url))) chrome.tabs.update(tab.id, { url: NEWTAB });
  }
}

fixStartupTabs().catch((e) => console.warn("newtab startup fix:", e));
