// Shared by the service worker and the popup.
const AdBlock = (() => {
  const LIST_IDS = ["easylist", "easyprivacy", "listkr"];
  const DEFAULTS = { enabled: true, lists: { easylist: true, easyprivacy: true, listkr: true }, allow: [] };

  async function load() {
    const { settings } = await chrome.storage.local.get("settings");
    return {
      enabled: settings?.enabled ?? DEFAULTS.enabled,
      lists: { ...DEFAULTS.lists, ...(settings?.lists || {}) },
      allow: Array.isArray(settings?.allow) ? settings.allow : [],
    };
  }

  // Push settings into declarativeNetRequest: which static rulesets are on, and the per-site allow rules.
  async function apply(settings) {
    const wanted = LIST_IDS.filter((id) => settings.enabled && settings.lists[id]);
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: wanted,
      disableRulesetIds: LIST_IDS.filter((id) => !wanted.includes(id)),
    });

    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: old.map((r) => r.id),
      addRules: settings.allow.map((host, i) => ({
        id: i + 1,
        priority: 100,
        action: { type: "allowAllRequests" },
        condition: { requestDomains: [host], resourceTypes: ["main_frame", "sub_frame"] },
      })),
    });
  }

  async function save(settings) {
    await chrome.storage.local.set({ settings });
    await apply(settings);
  }

  return { LIST_IDS, load, apply, save };
})();
