// Claude pane: claude.ai in the panel, with the things a narrow embedded page cannot offer on its own:
//  - shortcuts to the chat history, artifacts, projects and Claude Code (claude.ai/code) pages,
//  - "wide view" (own window) and "open in tab": artifacts and long chats need room, and the panel is only ~400px,
//  - one-tap prompts about the page you are looking at (summary / explain the selection / translate).
// The prompt travels in claude.ai's ?q= prefill, so only a short slice of the page fits.
import { icon } from "../../../ui/icons.js";
import { h, iconBtn, activeTab } from "../kit.js";

const CLAUDE = "https://claude.ai/";
const MAX_CHARS = 700; // ?q= goes through the URL: Korean text is 9 bytes per character once encoded

const NAV = [
  { id: "new", label: "새 대화", path: "new", icon: "plus" },
  { id: "recents", label: "기록", path: "recents", icon: "history" },
  { id: "artifacts", label: "아티팩트", path: "artifacts", icon: "layers" },
  { id: "projects", label: "프로젝트", path: "projects", icon: "folder" },
  { id: "code", label: "Claude Code", path: "code", icon: "code" },
];

async function pageContext() {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || "")) return null;
  let selection = "";
  let text = "";
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ selection: String(getSelection() || ""), text: (document.body && document.body.innerText) || "" }) });
    ({ selection, text } = r.result);
  } catch {} // pages that cannot be scripted (store, pdf viewer): fall back to title + address
  return { tab, selection: selection.trim(), text: text.replace(/\s+/g, " ").trim() };
}

const ACTIONS = [
  { id: "summary", label: "페이지 요약", build: (c) => `다음 웹페이지를 한국어로 핵심만 5줄 이내로 요약해 줘.\n제목: ${c.tab.title}\n주소: ${c.tab.url}\n\n${(c.selection || c.text).slice(0, MAX_CHARS)}` },
  { id: "explain", label: "선택 설명", needsSelection: true, build: (c) => `다음 내용을 쉽게 설명해 줘:\n\n${c.selection.slice(0, MAX_CHARS)}` },
  { id: "translate", label: "번역", build: (c) => `다음 내용을 자연스러운 한국어로 번역해 줘:\n\n${(c.selection || c.text).slice(0, MAX_CHARS)}` },
];

const navIdOf = (url) => {
  try {
    const first = new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    return NAV.find((n) => n.path === first)?.id || null;
  } catch {
    return null;
  }
};

export async function mount(root) {
  let lastUrl = CLAUDE; // where the embedded claude.ai currently is (tracked through webNavigation)
  const frame = h("iframe", { class: "claude-frame", src: CLAUDE, allow: "clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera" });
  const hint = h("p", { class: "chips-hint", hidden: true });
  const say = (text) => { hint.textContent = text || ""; hint.hidden = !text; };

  const go = (url) => { say(""); frame.src = url; lastUrl = url; paint(); };

  const navButtons = NAV.map((n) => h("button", { class: "chip nav", type: "button", title: n.label, "aria-label": n.label, dataset: { nav: n.id }, onclick: () => go(CLAUDE + n.path) }, h("span", { class: "chip-ico", html: icon(n.icon) }), h("span", { class: "chip-label" }, n.label)));
  const wide = iconBtn("maximize", "넓게 보기 (아티팩트·긴 대화에 좋아요)", () => chrome.windows.create({ url: lastUrl, type: "popup", width: 1180, height: 860 }));
  const inTab = iconBtn("external", "새 탭에서 열기", () => chrome.tabs.create({ url: lastUrl }));

  const actionChips = ACTIONS.map((a) => h("button", { class: "chip", type: "button", onclick: async () => {
    say("");
    const ctx = await pageContext();
    if (!ctx) return say("지금 보는 페이지를 읽을 수 없어요. 일반 웹페이지에서 눌러 보세요.");
    if (a.needsSelection && !ctx.selection) return say("페이지에서 먼저 글자를 드래그해 선택하세요.");
    go(CLAUDE + "new?q=" + encodeURIComponent(a.build(ctx)));
  } }, a.label));

  const codeNote = h("p", { class: "code-note", hidden: true },
    "터미널의 Claude Code에서 ", h("code", {}, "/chrome"), " 을 실행하면 이 브라우저를 연결할 수 있어요. ",
    h("button", { class: "link", type: "button", onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("modules/claude/welcome.html") }) }, "연결 안내"));

  function paint() {
    const active = navIdOf(lastUrl);
    for (const b of navButtons) b.classList.toggle("on", b.dataset.nav === active);
    codeNote.hidden = active !== "code";
  }

  const track = (d) => {
    if (d.frameId === 0 || !/^https:\/\/claude\.ai\//.test(d.url)) return; // only the embedded page (never a claude.ai tab)
    lastUrl = d.url;
    paint();
  };
  chrome.webNavigation.onCommitted.addListener(track);
  chrome.webNavigation.onHistoryStateUpdated.addListener(track);

  root.replaceChildren(
    h("div", { class: "claude-bar" },
      h("div", { class: "bar-row" }, h("div", { class: "chips" }, navButtons), wide, inTab),
      h("div", { class: "bar-row small" }, h("span", { class: "bar-label" }, "지금 보는 페이지"), h("div", { class: "chips" }, actionChips)),
      codeNote, hint),
    frame
  );
  paint();
  return {
    destroy: () => {
      chrome.webNavigation.onCommitted.removeListener(track);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(track);
    },
  };
}
