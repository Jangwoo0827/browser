// Notes pane: quick notes next to the page you are reading. A list (search, newest first) and an editor that saves as you
// type. A note may carry the link of the page it came from. Notes live in chrome.storage.local ("notes"), which the
// context-menu entry "Fjord 메모에 추가" (modules/notes/background.js) also writes to.
import { icon } from "../../../ui/icons.js";
import { h, favicon, hostOf, iconBtn, searchBox, empty, toast, activeTab, openUrl } from "../kit.js";

const newId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const load = async () => (await chrome.storage.local.get("notes")).notes || [];
const lines = (n) => n.body.split("\n").map((l) => l.trim()).filter(Boolean);
const titleOf = (n) => (lines(n)[0] || "새 메모").slice(0, 80);
const snippetOf = (n) => lines(n).slice(1).join(" ").slice(0, 110);

function when(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

export async function mount(root) {
  let notes = await load();
  let editing = null; // the note being edited (object from `notes`)
  let saveTimer = null;

  const persist = () => chrome.storage.local.set({ notes });
  const sorted = () => [...notes].sort((a, b) => b.updated - a.updated);

  // ---------- list ----------
  const list = h("div", { class: "list" });
  const search = searchBox("메모 검색", () => renderList());
  const addBtn = iconBtn("plus", "새 메모", () => openEditor(null), "primary");
  const listView = h("div", { class: "notes-list-view" }, h("div", { class: "pane-bar" }, search.el, addBtn), list);

  function card(n) {
    const link = n.url ? h("span", { class: "note-link" }, favicon(n.url, n.pageTitle), hostOf(n.url)) : null;
    return h("div", { class: "note-card", tabindex: "0", onclick: () => openEditor(n), onkeydown: (e) => e.key === "Enter" && openEditor(n) },
      h("div", { class: "note-top" }, h("span", { class: "note-title" }, titleOf(n)), h("span", { class: "note-when" }, when(n.updated))),
      snippetOf(n) && h("p", { class: "note-snippet" }, snippetOf(n)),
      link,
      h("span", { class: "row-actions" }, iconBtn("trash", "삭제", () => remove(n))));
  }

  function renderList() {
    const q = search.value.toLowerCase();
    const shown = sorted().filter((n) => !q || n.body.toLowerCase().includes(q) || (n.url || "").toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(card) : [empty(q ? "검색 결과가 없어요" : "메모가 없어요", q ? `"${q}"와 맞는 메모가 없어요.` : "위의 + 버튼으로 새 메모를 만들거나, 페이지에서 글자를 선택하고 우클릭 → \"Fjord 메모에 추가\"를 눌러 보세요.")]));
  }

  async function remove(n) {
    notes = notes.filter((x) => x.id !== n.id);
    await persist();
    renderList();
    toast("메모를 지웠어요", "되돌리기", async () => { notes.push(n); await persist(); renderList(); });
  }

  // ---------- editor ----------
  async function openEditor(existing) {
    let note = existing;
    if (!note) {
      const tab = await activeTab();
      note = { id: newId(), body: "", created: Date.now(), updated: Date.now() };
      if (tab && /^https?:/.test(tab.url || "")) { note.url = tab.url; note.pageTitle = tab.title || ""; } // new notes remember the page they were started on
    }
    editing = note;
    const area = h("textarea", { class: "note-body", placeholder: "여기에 메모하세요…", spellcheck: "false" });
    area.value = note.body;
    const when_ = h("span", { class: "note-meta" });
    const linkSlot = h("div", { class: "note-attach" });
    const paintMeta = () => { when_.textContent = note.body ? `수정 ${when(note.updated)}` : "새 메모"; };
    const paintLink = () => {
      linkSlot.replaceChildren(...(note.url
        ? [h("button", { class: "chip", type: "button", title: note.url, onclick: () => openUrl(note.url) }, favicon(note.url, note.pageTitle), hostOf(note.url)),
           iconBtn("close", "링크 떼기", () => { delete note.url; delete note.pageTitle; touch(); paintLink(); })]
        : [h("button", { class: "chip ghost", type: "button", onclick: async () => {
            const tab = await activeTab();
            if (!tab || !/^https?:/.test(tab.url || "")) return toast("이 페이지는 연결할 수 없어요");
            note.url = tab.url; note.pageTitle = tab.title || ""; touch(); paintLink();
          } }, h("span", { class: "chip-ico", html: icon("external") }), "지금 보는 페이지 연결")]));
    };
    const touch = () => {
      note.updated = Date.now();
      if (!notes.includes(note)) notes.push(note);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 350);
      paintMeta();
    };
    area.addEventListener("input", () => { note.body = area.value; touch(); });

    const back = async () => {
      clearTimeout(saveTimer);
      if (!note.body.trim()) notes = notes.filter((x) => x !== note); // a note left empty is not kept
      await persist();
      editing = null;
      root.replaceChildren(listView);
      renderList();
    };
    const view = h("div", { class: "note-editor" },
      h("div", { class: "pane-bar" }, h("button", { class: "chip nav", type: "button", onclick: back }, h("span", { class: "chip-ico", html: icon("arrowLeft") }), h("span", { class: "chip-label", style: "display:inline" }, "목록")),
        h("span", { class: "grow" }), iconBtn("trash", "삭제", async () => { clearTimeout(saveTimer); const gone = note; notes = notes.filter((x) => x !== gone); await persist(); editing = null; root.replaceChildren(listView); renderList(); if (gone.body.trim()) toast("메모를 지웠어요", "되돌리기", async () => { notes.push(gone); await persist(); renderList(); }); })),
      area, h("div", { class: "note-foot" }, linkSlot, when_));
    paintMeta();
    paintLink();
    root.replaceChildren(view);
    area.focus();
  }

  // notes added from the page (context menu) while the pane is open
  const onChanged = async (changes, area) => {
    if (area !== "local" || !changes.notes || editing) return;
    notes = changes.notes.newValue || [];
    renderList();
  };
  chrome.storage.onChanged.addListener(onChanged);

  root.replaceChildren(listView);
  renderList();
  return { destroy: () => { clearTimeout(saveTimer); if (editing && !notes.includes(editing)) return; persist(); chrome.storage.onChanged.removeListener(onChanged); } };
}
