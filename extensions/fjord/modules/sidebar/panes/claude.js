// Claude pane: claude.ai in the panel plus one-tap prompts about the page you are looking at (summary / explain the
// selection / translate / new chat). The prompt travels in claude.ai's ?q= prefill, so only a short slice of the page fits.
import { h, activeTab } from "../kit.js";

const CLAUDE = "https://claude.ai/";
const MAX_CHARS = 700; // ?q= goes through the URL: Korean text is 9 bytes per character once encoded

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
  { id: "new", label: "새 대화", build: () => null },
];

export async function mount(root) {
  const frame = h("iframe", { class: "claude-frame", src: CLAUDE, allow: "clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera" });
  const hint = h("p", { class: "chips-hint", hidden: true });
  const chips = h("div", { class: "chips" }, ACTIONS.map((a) => h("button", { class: "chip" + (a.id === "new" ? " ghost" : ""), type: "button", onclick: async () => {
    hint.hidden = true;
    if (a.id === "new") { frame.src = CLAUDE + "new"; return; }
    const ctx = await pageContext();
    if (!ctx) { hint.textContent = "지금 보는 페이지를 읽을 수 없어요. 일반 웹페이지에서 눌러 보세요."; hint.hidden = false; return; }
    if (a.needsSelection && !ctx.selection) { hint.textContent = "페이지에서 먼저 글자를 드래그해 선택하세요."; hint.hidden = false; return; }
    frame.src = CLAUDE + "new?q=" + encodeURIComponent(a.build(ctx));
  } }, a.label)));
  root.replaceChildren(h("div", { class: "claude-bar" }, chips, hint), frame);
  return { destroy: () => {} };
}
