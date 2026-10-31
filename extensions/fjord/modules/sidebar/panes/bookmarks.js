// Bookmarks pane: folder tree (collapsible, remembered), search, add the current page, hover actions, undo for delete.
import { icon } from "../../../ui/icons.js";
import { h, favicon, hostOf, iconBtn, searchBox, empty, debounce, toast, openUrl, wantsNewTab, activeTab } from "../kit.js";

const OPEN_KEY = "fjord.bm.open";
const loadOpen = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '["1"]')); // "1" = bookmarks bar
  } catch {
    return new Set(["1"]);
  }
};

export async function mount(root) {
  const open = loadOpen();
  let roots = [];
  const list = h("div", { class: "list", role: "tree" });
  const search = searchBox("북마크 검색", () => render());
  const addBtn = iconBtn("plus", "현재 페이지를 북마크 바에 추가", async () => {
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) return toast("이 페이지는 북마크할 수 없어요");
    const existing = await chrome.bookmarks.search({ url: tab.url });
    if (existing.length) return toast("이미 북마크한 페이지예요");
    await chrome.bookmarks.create({ parentId: "1", title: tab.title || tab.url, url: tab.url });
    toast("북마크에 추가했어요");
  }, "primary");
  root.replaceChildren(h("div", { class: "pane-bar" }, search.el, addBtn), list);

  const save = () => localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  const count = (n) => (n.children ? n.children.reduce((s, c) => s + count(c), 0) : 1);

  function bookmarkRow(n, depth, showPath) {
    const go = (e) => openUrl(n.url, { newTab: wantsNewTab(e) });
    const row = h("div", { class: "row", role: "treeitem", tabindex: "0", title: `${n.title}\n${n.url}`, style: `--depth:${depth}`, onclick: go, onauxclick: (e) => e.button === 1 && go(e),
      onkeydown: (e) => e.key === "Enter" && go(e) },
      favicon(n.url, n.title),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, n.title || hostOf(n.url)), h("span", { class: "row-sub" }, showPath || hostOf(n.url))),
      h("span", { class: "row-actions" },
        iconBtn("external", "새 탭에서 열기", () => openUrl(n.url, { newTab: true })),
        iconBtn("trash", "삭제", async () => {
          await chrome.bookmarks.remove(n.id);
          toast("북마크를 지웠어요", "되돌리기", () => chrome.bookmarks.create({ parentId: n.parentId, index: n.index, title: n.title, url: n.url }));
        })));
    return row;
  }

  function folderRow(n, depth, out) {
    const isOpen = open.has(n.id);
    const toggle = () => { isOpen ? open.delete(n.id) : open.add(n.id); save(); render(); };
    out.push(h("div", { class: "row folder", role: "treeitem", "aria-expanded": String(isOpen), tabindex: "0", style: `--depth:${depth}`, onclick: toggle, onkeydown: (e) => (e.key === "Enter" || e.key === " ") && toggle() },
      h("span", { class: "chev" + (isOpen ? " open" : ""), html: icon("chevronRight") }),
      h("span", { class: "folder-ico", html: icon("folder") }),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, n.title || "(이름 없음)")),
      h("span", { class: "row-count" }, String(count(n)))));
    if (isOpen) for (const c of n.children || []) walk(c, depth + 1, out);
  }

  function walk(n, depth, out) {
    if (n.children) folderRow(n, depth, out);
    else if (n.url) out.push(bookmarkRow(n, depth));
  }

  async function render() {
    const q = search.value;
    if (q) {
      const hits = (await chrome.bookmarks.search(q)).filter((n) => n.url);
      list.replaceChildren(...(hits.length ? hits.map((n) => bookmarkRow(n, 0, hostOf(n.url))) : [empty("검색 결과가 없어요", `"${q}"와 맞는 북마크가 없어요.`)]));
      return;
    }
    const out = [];
    for (const r of roots) if ((r.children || []).length) folderRow(r, 0, out);
    list.replaceChildren(...(out.length ? out : [empty("북마크가 없어요", "위의 + 버튼으로 지금 보는 페이지를 추가해 보세요.")]));
  }

  async function reload() {
    roots = (await chrome.bookmarks.getTree())[0].children || [];
    render();
  }

  const refresh = debounce(reload, 80);
  const events = ["onCreated", "onRemoved", "onChanged", "onMoved"].map((e) => chrome.bookmarks[e]);
  for (const ev of events) ev.addListener(refresh);
  await reload();
  return { destroy: () => events.forEach((ev) => ev.removeListener(refresh)) };
}
