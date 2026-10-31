// Reading list pane: pages saved to read later (Chrome's own reading list, so it also shows up in Chrome's UI).
// Unread first, filter chips (전체 / 안 읽음), add the current page, mark read, remove.
import { h, favicon, hostOf, iconBtn, empty, toast, openUrl, wantsNewTab, activeTab, debounce } from "../kit.js";

export async function mount(root) {
  let entries = [];
  let onlyUnread = false;
  const list = h("div", { class: "list" });
  const all = h("button", { class: "chip nav on", type: "button", onclick: () => setFilter(false) }, h("span", { class: "chip-label", style: "display:inline" }, "전체"));
  const unread = h("button", { class: "chip nav", type: "button", onclick: () => setFilter(true) }, h("span", { class: "chip-label", style: "display:inline" }, "안 읽음"));
  const addBtn = iconBtn("plus", "지금 보는 페이지를 읽기 목록에 추가", async () => {
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) return toast("이 페이지는 추가할 수 없어요");
    try {
      await chrome.readingList.addEntry({ url: tab.url, title: tab.title || tab.url, hasBeenRead: false });
      toast("읽기 목록에 추가했어요");
    } catch {
      toast("이미 읽기 목록에 있어요");
    }
  }, "primary");
  root.replaceChildren(h("div", { class: "pane-bar" }, all, unread, h("span", { style: "flex:1" }), addBtn), list);

  function setFilter(v) {
    onlyUnread = v;
    all.classList.toggle("on", !v);
    unread.classList.toggle("on", v);
    render();
  }

  function row(e) {
    const go = async (ev) => {
      await openUrl(e.url, { newTab: wantsNewTab(ev) });
      if (!e.hasBeenRead) chrome.readingList.updateEntry({ url: e.url, hasBeenRead: true }).catch(() => {});
    };
    return h("div", { class: "row" + (e.hasBeenRead ? " read" : ""), tabindex: "0", title: `${e.title}\n${e.url}`, onclick: go, onauxclick: (ev) => ev.button === 1 && go(ev), onkeydown: (ev) => ev.key === "Enter" && go(ev) },
      h("span", { class: "dot" + (e.hasBeenRead ? "" : " on"), title: e.hasBeenRead ? "읽음" : "안 읽음" }),
      favicon(e.url, e.title),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, e.title || hostOf(e.url)), h("span", { class: "row-sub" }, hostOf(e.url))),
      h("span", { class: "row-actions" },
        iconBtn("history", e.hasBeenRead ? "안 읽음으로 표시" : "읽음으로 표시", () => chrome.readingList.updateEntry({ url: e.url, hasBeenRead: !e.hasBeenRead })),
        iconBtn("trash", "읽기 목록에서 지우기", async () => {
          await chrome.readingList.removeEntry({ url: e.url });
          toast("읽기 목록에서 지웠어요", "되돌리기", () => chrome.readingList.addEntry({ url: e.url, title: e.title, hasBeenRead: e.hasBeenRead }));
        })));
  }

  function render() {
    const shown = entries.filter((e) => !onlyUnread || !e.hasBeenRead).sort((a, b) => Number(a.hasBeenRead) - Number(b.hasBeenRead) || b.creationTime - a.creationTime);
    list.replaceChildren(...(shown.length ? shown.map(row) : [empty(onlyUnread ? "안 읽은 글이 없어요" : "읽기 목록이 비었어요", "위의 + 버튼이나 리더 모드의 \"읽기 목록에 추가\"로 나중에 읽을 글을 모아 보세요.")]));
  }

  async function load() {
    entries = await chrome.readingList.query({});
    render();
  }

  const refresh = debounce(load, 80);
  const events = [chrome.readingList.onEntryAdded, chrome.readingList.onEntryRemoved, chrome.readingList.onEntryUpdated];
  for (const ev of events) ev.addListener(refresh);
  await load();
  return { destroy: () => events.forEach((ev) => ev.removeListener(refresh)) };
}
