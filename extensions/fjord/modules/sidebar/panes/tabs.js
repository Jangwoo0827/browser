// Open tabs of every window, grouped by workspace (a workspace is one window), with search, audio marker and close.
import { icon } from "../../../ui/icons.js";
import { h, favicon, hostOf, iconBtn, searchBox, empty, debounce } from "../kit.js";

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
  root.replaceChildren(h("div", { class: "pane-bar" }, search.el), list);
  let windows = [];
  let names = {};
  let currentWindow = null;

  function row(tab) {
    const go = async () => {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    };
    return h("div", { class: "row" + (tab.active ? " current" : ""), tabindex: "0", title: `${tab.title}\n${tab.url}`, onclick: go, onkeydown: (e) => e.key === "Enter" && go() },
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
      out.push(...tabs.map(row));
    });
    list.replaceChildren(...(out.length ? out : [empty(q ? "검색 결과가 없어요" : "열린 탭이 없어요")]));
  }

  async function load() {
    [windows, names, currentWindow] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
      workspaceNames(),
      chrome.windows.getLastFocused().then((w) => w.id).catch(() => null),
    ]);
    windows.sort((a, b) => (a.id === currentWindow ? -1 : b.id === currentWindow ? 1 : a.id - b.id));
    render();
  }

  const refresh = debounce(load, 120);
  const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.windows.onRemoved, chrome.windows.onFocusChanged];
  for (const ev of events) ev.addListener(refresh);
  await load();
  return { destroy: () => events.forEach((ev) => ev.removeListener(refresh)) };
}
