// Claude is not bundled or redistributed: on first run we guide the user to install it from the Chrome Web Store.
import { CLAUDE_ID } from "./ids.js";

async function claudeInstalled() {
  try {
    return (await chrome.management.get(CLAUDE_ID)).enabled;
  } catch {
    return false; // not installed
  }
}

// Once per browser session, unless the user chose "don't ask again".
async function offerInstall() {
  const { claudeSetup } = await chrome.storage.local.get("claudeSetup");
  if (claudeSetup?.dismissed) return;
  const { claudeAsked } = await chrome.storage.session.get("claudeAsked");
  if (claudeAsked) return;
  await chrome.storage.session.set({ claudeAsked: true });
  if (await claudeInstalled()) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL("modules/claude/welcome.html"), active: false });
}

// Wait a moment so the startup tab fix and workspace grouping settle first.
setTimeout(() => offerInstall().catch((e) => console.warn("claude setup:", e)), 4000);
