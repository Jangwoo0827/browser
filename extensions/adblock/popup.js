const $ = (id) => document.getElementById(id);
let settings;
let tab;
let host = null;

async function meta() {
  try {
    return await (await fetch(chrome.runtime.getURL("rules/meta.json"))).json();
  } catch {
    return null;
  }
}

async function countBlocked() {
  if (!tab) return "-";
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    return rulesMatchedInfo.filter((r) => r.rule.rulesetId !== "_dynamic").length;
  } catch {
    return "-";
  }
}

async function render() {
  $("host").textContent = host || "(이 페이지에서는 사용할 수 없어요)";
  $("siteOn").disabled = !host;
  $("siteOn").checked = host ? !settings.allow.includes(host) : false;
  $("globalOn").checked = settings.enabled;
  $("count").textContent = `이 탭에서 적용된 규칙: ${await countBlocked()}`;

  const m = await meta();
  const counts = Object.fromEntries((m?.lists || []).map((l) => [l.id, l]));
  const box = $("lists");
  box.replaceChildren();
  for (const id of AdBlock.LIST_IDS) {
    const label = document.createElement("label");
    label.className = "switch sub";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = settings.lists[id];
    cb.disabled = !settings.enabled;
    cb.onchange = async () => {
      settings.lists[id] = cb.checked;
      await AdBlock.save(settings);
      render();
    };
    const name = document.createElement("span");
    name.textContent = counts[id]?.name || id;
    const small = document.createElement("small");
    small.textContent = counts[id] ? `${counts[id].rules.toLocaleString()}개` : "";
    label.append(cb, name, small);
    box.append(label);
  }

  $("info").textContent = m ? `필터 갱신: ${new Date(m.updated).toLocaleDateString("ko-KR")}` : "";

  // Rulesets Chrome refused to enable (global static-rule budget exceeded) show up here.
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const missing = AdBlock.LIST_IDS.filter((id) => settings.enabled && settings.lists[id] && !enabled.includes(id));
  const warn = $("warn");
  warn.hidden = missing.length === 0;
  if (missing.length) {
    const left = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
    warn.textContent = `규칙 한도 때문에 꺼진 목록: ${missing.join(", ")} (남은 여유 ${left.toLocaleString()}개)`;
  }
}

$("globalOn").onchange = async () => {
  settings.enabled = $("globalOn").checked;
  await AdBlock.save(settings);
  render();
};

$("siteOn").onchange = async () => {
  if (!host) return;
  settings.allow = settings.allow.filter((h) => h !== host);
  if (!$("siteOn").checked) settings.allow.push(host);
  await AdBlock.save(settings);
  render();
  if (tab) chrome.tabs.reload(tab.id);
};

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const u = new URL(tab.url);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname.replace(/^www\./, "");
  } catch {}
  settings = await AdBlock.load();
  render();
})();
