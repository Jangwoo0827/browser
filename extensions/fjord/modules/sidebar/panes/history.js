// History pane: search, grouped by day (오늘 / 어제 / 날짜), delete one entry, jump to the full "clear data" dialog.
import { h, favicon, hostOf, iconBtn, searchBox, empty, debounce, toast, openUrl, wantsNewTab } from "../kit.js";

const DAY = 86400e3;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayLabel = (t) => {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
};
const timeLabel = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

export async function mount(root) {
  const list = h("div", { class: "list" });
  const search = searchBox("기록 검색", () => load());
  const clearBtn = iconBtn("trash", "인터넷 사용 기록 삭제…", () => chrome.tabs.create({ url: "chrome://settings/clearBrowserData" }));
  root.replaceChildren(h("div", { class: "pane-bar" }, search.el, clearBtn), list);

  function entry(item) {
    const go = (e) => openUrl(item.url, { newTab: wantsNewTab(e) });
    return h("div", { class: "row", tabindex: "0", title: `${item.title || item.url}\n${item.url}`, onclick: go, onauxclick: (e) => e.button === 1 && go(e), onkeydown: (e) => e.key === "Enter" && go(e) },
      favicon(item.url, item.title),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, item.title || hostOf(item.url)), h("span", { class: "row-sub" }, `${hostOf(item.url)} · ${timeLabel(item.lastVisitTime)}`)),
      h("span", { class: "row-actions" }, iconBtn("close", "기록에서 지우기", async () => {
        await chrome.history.deleteUrl({ url: item.url });
        toast("기록에서 지웠어요");
        load();
      })));
  }

  async function load() {
    const q = search.value;
    const items = await chrome.history.search({ text: q, maxResults: q ? 200 : 500, startTime: 0 });
    if (!items.length) return list.replaceChildren(empty(q ? "검색 결과가 없어요" : "방문 기록이 없어요", q ? `"${q}"와 맞는 기록이 없어요.` : "페이지를 열면 여기에 쌓여요."));
    const out = [];
    let last = null;
    for (const item of items) { // history.search returns newest first
      const label = dayLabel(item.lastVisitTime);
      if (label !== last) { out.push(h("div", { class: "group-head" }, label)); last = label; }
      out.push(entry(item));
    }
    list.replaceChildren(...out);
  }

  const refresh = debounce(load, 250);
  chrome.history.onVisited.addListener(refresh);
  chrome.history.onVisitRemoved.addListener(refresh);
  await load();
  return { destroy: () => { chrome.history.onVisited.removeListener(refresh); chrome.history.onVisitRemoved.removeListener(refresh); } };
}
