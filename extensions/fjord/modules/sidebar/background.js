import { Store } from "./store.js";

// Pages embedded by the side panel are sub_frames whose initiator is this extension.
// Strip the headers that forbid framing, only for those requests. A *session* rule is used so it can't
// collide with the dynamic rule ids the ad blocker module manages.
const FRAME_RULE_ID = 900001;

async function installFrameRule() {
  await chrome.declarativeNetRequest.updateSessionRules({
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
}

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await installFrameRule();
  const { items } = await chrome.storage.local.get("items");
  if (!Array.isArray(items)) await Store.saveItems(Store.DEFAULT_ITEMS);
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
setup().catch((e) => console.warn("sidebar setup:", e)); // session rules are gone after a browser restart
