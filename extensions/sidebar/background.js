importScripts("store.js");

// Pages embedded by this extension's side panel are sub_frames whose initiator is the extension itself.
// Strip the headers that forbid framing, only for those requests.
const FRAME_RULE_ID = 1;

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [FRAME_RULE_ID],
    addRules: [
      {
        id: FRAME_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "x-frame-options", operation: "remove" },
            { header: "content-security-policy", operation: "remove" },
          ],
        },
        condition: { resourceTypes: ["sub_frame"], initiatorDomains: [chrome.runtime.id] },
      },
    ],
  });

  const { items } = await chrome.storage.local.get("items");
  if (!Array.isArray(items)) await Store.saveItems(Store.DEFAULT_ITEMS);
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
