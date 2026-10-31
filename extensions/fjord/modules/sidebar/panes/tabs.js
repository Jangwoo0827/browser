// Open tabs of every window, grouped by workspace (a workspace is one window), with search, audio marker and close.
import { icon } from "../../../ui/icons.js";
import { h, favicon, hostOf, iconBtn, searchBox, empty, debounce, toast } from "../kit.js";

const GROUP_COLORS = { grey: "#5f6368", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038", pink: "#d01884", purple: "#9334e6", cyan: "#007b83", orange: "#fa7b17" };
const PALETTE = Object.keys(GROUP_COLORS);

async function workspaceNames() {
  const [{ wsWindows }, { workspaces }] = await Promise.all([chrome.storage.session.get("wsWindows"), chrome.storage.local.get("workspaces")]);
  const names = {};
  for (const [wsId, windowId] of Object.entries(wsWindows || {})) {
    const ws = (workspaces || []).find((w) => w.id === wsId);
    if (ws) names[windowId] = { name: ws.name, icon: ws.icon || "home" };
  }
  return names;
}

export async function mount(root) {
  const list = h("div", { class: "list" });
  const search = searchBox("열린 탭 검색", () => render());
  const groupBtn = iconBtn("layers", "같은 사이트의 탭을 그룹으로 묶기 (이 창)", () => groupBySite());
  const ungroupBtn = iconBtn("close", "이 창의 탭 그룹 모두 풀기", () => ungroupAll());
  root.replaceChildren(h("div", { class: "pane-bar" }, search.el, groupBtn, ungroupBtn), list);
  let windows = [];
  let groups = new Map(); // group id -> { id, title, color, collapsed }
  let names = {};
  let currentWindow = null;

  async function groupBySite() {
    const win = windows.find((w) => w.id === currentWindow);
    if (!win) return;
    const byHost = new Map();
    for (const tab of win.tabs || []) {
      const host = /^https?:/.test(tab.url || "") ? hostOf(tab.url) : "";
      if (!host || tab.pinned || tab.groupId !== -1) continue;
      byHost.set(host, [...(byHost.get(host) || []), tab.id]);
    }
    let made = 0;
    for (const [host, ids] of byHost) {
      if (ids.length < 2) continue;
      const id = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: win.id } });
      await chrome.tabGroups.update(id, { title: host, color: PALETTE[(made + 1) % PALETTE.length] });
      made++;
    }
    toast(made ? `${made}개 그룹으로 묶었어요` : "묶을 탭이 없어요 (같은 사이트의 탭이 2개 이상이어야 해요)");
  }

  async function ungroupAll() {
    const win = windows.find((w) => w.id === currentWindow);
    const ids = ((win && win.tabs) || []).filter((tab) => tab.groupId !== -1).map((tab) => tab.id);
    if (!ids.length) return toast("풀 그룹이 없어요");
    await chrome.tabs.ungroup(ids);
    toast("탭 그룹을 모두 풀었어요");
  }

  function groupHead(g, count) {
    const color = GROUP_COLORS[g.color] || GROUP_COLORS.grey;
    return h("div", { class: "group-head tabgroup", style: `--gc:${color}`, tabindex: "0", title: g.collapsed ? "펼치기" : "접기", onclick: () => chrome.tabGroups.update(g.id, { collapsed: !g.collapsed }),
      onkeydown: (e) => (e.key === "Enter" || e.key === " ") && chrome.tabGroups.update(g.id, { collapsed: !g.collapsed }) },
      h("span", { class: "gdot" }), g.title || "이름 없는 그룹", h("span", { class: "group-count" }, `${count}${g.collapsed ? " · 접힘" : ""}`));
  }

  function row(tab) {
    const go = async () => {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    };
    const g = tab.groupId !== -1 && groups.get(tab.groupId);
    return h("div", { class: "row" + (tab.active ? " current" : "") + (g ? " grouped" : ""), style: g ? `--gc:${GROUP_COLORS[g.color] || GROUP_COLORS.grey}` : null, tabindex: "0", title: `${tab.title}\n${tab.url}`, onclick: go, onkeydown: (e) => e.key === "Enter" && go() },
      favicon(tab.url, tab.title),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, tab.title || hostOf(tab.url)), h("span", { class: "row-sub" }, hostOf(tab.url) || "새 탭")),
      tab.audible && h("span", { class: "row-flag", title: tab.mutedInfo?.muted ? "음소거됨" : "소리 재생 중", html: icon(tab.mutedInfo?.muted ? "volumeOff" : "volume") }),
      h("span", { class: "row-actions" }, iconBtn("close", "탭 닫기", () => chrome.tabs.remove(tab.id))));
  }

  function render() {
    const q = search.value.toLowerCase();
    const out = [];
    windows.forEach((w, i) => {
      const tabs = (w.tabs || []).filter((t) => !q || (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q));
      if (!tabs.length) return;
      const ws = names[w.id];
      out.push(h("div", { class: "group-head with-ico" }, h("span", { html: icon(ws?.icon || "layers") }), ws?.name || `창 ${i + 1}`,
        w.id === currentWindow && windows.length > 1 && h("span", { class: "badge" }, "현재"), h("span", { class: "group-count" }, String(tabs.length))));
      let lastGroup = -1;
      for (const tab of tabs) {
        const g = tab.groupId !== -1 ? groups.get(tab.groupId) : null;
        if (g && tab.groupId !== lastGroup) out.push(groupHead(g, (w.tabs || []).filter((x) => x.groupId === g.id).length));
        lastGroup = tab.groupId;
        if (g && g.collapsed && !q) continue; // a collapsed group hides its tabs (searching shows them)
        out.push(row(tab));
      }
    });
    list.replaceChildren(...(out.length ? out : [empty(q ? "검색 결과가 없어요" : "열린 탭이 없어요")]));
  }

  async function load() {
    let groupList = [];
    try { groupList = await chrome.tabGroups.query({}); } catch {}
    groups = new Map(groupList.map((g) => [g.id, g]));
    [windows, names, currentWindow] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
      workspaceNames(),
      chrome.windows.getLastFocused().then((w) => w.id).catch(() => null),
    ]);
    windows.sort((a, b) => (a.id === currentWindow ? -1 : b.id === currentWindow ? 1 : a.id - b.id));
    render();
  }

  const refresh = debounce(load, 120);
  const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.windows.onRemoved, chrome.windows.onFocusChanged, chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved];
  for (const ev of events) ev.addListener(refresh);
  await load();
  return { destroy: () => events.forEach((ev) => ev.removeListener(refresh)) };
}
