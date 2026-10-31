// The quick find box itself. Used inside a shadow root on web pages and directly in the popup window (quick.html).
// It talks to modules/quick/background.js through messages, so it also works where chrome.tabs & co. do not exist.
import { icon } from "../../ui/icons.js";

const KIND_LABEL = { tab: "탭", bookmark: "북마크", history: "기록", ws: "워크스페이스", cmd: "명령", search: "검색", url: "열기" };
const send = (msg) => chrome.runtime.sendMessage(msg);
const looksLikeUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || (/^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(s) && !/\s/.test(s));
const toUrl = (s) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s);

// commands: run in the UI (workspace switching and the rail's settings message are answered by other modules)
function commandList(inPage) {
  const list = [
    { title: "설정 열기", sub: "Fjord 설정", icon: "sliders", run: () => send({ type: "rail:settings" }) },
    { title: "광고 차단 켜기/끄기", sub: "모든 사이트", icon: "shield", run: async () => { const { enabled = true } = await chrome.storage.local.get("enabled"); await chrome.storage.local.set({ enabled: !enabled }); } },
    { title: "인터넷 사용 기록 삭제", sub: "Chrome 설정", icon: "trash", run: () => send({ type: "quick:open-internal", url: "chrome://settings/clearBrowserData" }) },
    { title: "북마크 관리자", sub: "chrome://bookmarks", icon: "bookmark", run: () => send({ type: "quick:open-internal", url: "chrome://bookmarks" }) },
    { title: "다운로드", sub: "chrome://downloads", icon: "download", run: () => send({ type: "quick:open-internal", url: "chrome://downloads" }) },
    { title: "확장 프로그램", sub: "chrome://extensions", icon: "layers", run: () => send({ type: "quick:open-internal", url: "chrome://extensions" }) },
  ];
  const tool = (id) => () => send({ type: "tools:run", id });
  list.push(
    { title: "리더 모드", sub: "글만 깔끔하게 읽기", icon: "book", run: tool("reader") },
    { title: "스크린샷: 보이는 영역", sub: "다운로드 폴더에 저장", icon: "maximize", run: tool("shot-visible") },
    { title: "스크린샷: 영역 선택", sub: "드래그해서 캡처 (Alt+S)", icon: "maximize", run: tool("shot-region") },
    { title: "스크린샷: 전체 페이지", sub: "끝까지 스크롤해서 한 장으로", icon: "maximize", run: tool("shot-full") },
    { title: "페이지 저장 (.mhtml)", sub: "오프라인에서도 열려요", icon: "download", run: tool("save-mhtml") },
    { title: "이 페이지 번역", sub: "Google 번역으로 열기 (주소가 Google로 전송돼요)", icon: "globe", run: tool("translate") },
    { title: "PDF로 저장 / 인쇄", sub: "인쇄 창에서 PDF로 저장 선택", icon: "download", run: tool("print") },
    { title: "읽기 목록에 추가", sub: "나중에 읽기", icon: "book", run: tool("reading-add") },
    { title: "페이지 공유 / QR 코드", sub: "링크 복사, 공유, 휴대폰으로 열기", icon: "external", run: tool("share") },
    { title: "프로필 관리", sub: "프로필 추가·전환 (Chrome 설정)", icon: "home", run: () => send({ type: "quick:open-internal", url: "chrome://settings/manageProfile" }) }
  );
  if (inPage) { // the side panel can only be opened from a page (it needs the click's user activation)
    for (const [id, title, ico] of [["@claude", "Claude 패널 열기", "sparkles"], ["@bookmarks", "북마크 패널 열기", "bookmark"], ["@history", "기록 패널 열기", "history"], ["@notes", "메모 패널 열기", "edit"], ["@readinglist", "읽기 목록 패널 열기", "book"], ["@tabs", "열린 탭 패널 열기", "tabs"]]) {
      list.push({ title, sub: "사이드 패널", icon: ico, run: () => send({ type: "rail:open", id }) });
    }
  }
  return list.map((c) => ({ kind: "cmd", ...c }));
}

async function workspaceItems() {
  const { workspaces, wsActive } = await chrome.storage.local.get(["workspaces", "wsActive"]);
  return (workspaces || []).map((w) => ({ kind: "ws", id: w.id, title: w.name, sub: w.id === wsActive ? "지금 워크스페이스" : "워크스페이스로 전환", icon: w.icon || "home" }));
}

export function mountQuick(root, { close, inPage = true }) {
  const input = Object.assign(document.createElement("input"), { className: "qk-input", type: "text", spellcheck: false, autocomplete: "off", placeholder: "탭, 북마크, 기록, 명령을 찾거나 주소·검색어를 입력" });
  input.setAttribute("aria-label", "빠른 검색");
  const list = Object.assign(document.createElement("ul"), { className: "qk-list", role: "listbox" });
  const foot = Object.assign(document.createElement("div"), { className: "qk-foot" });
  foot.innerHTML = "<span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 새 탭</span><span><kbd>Esc</kbd> 닫기</span>";
  const head = document.createElement("div");
  head.className = "qk-head";
  head.innerHTML = `<span class="qk-ico">${icon("search")}</span>`;
  head.append(input);
  const box = Object.assign(document.createElement("div"), { className: "qk-box" });
  box.append(head, list, foot);
  const backdrop = Object.assign(document.createElement("div"), { className: "qk-backdrop" });
  backdrop.append(box);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  root.append(backdrop);

  let items = [];
  let index = 0;
  let seq = 0;

  function row(item, i) {
    const li = document.createElement("li");
    li.className = "qk-item" + (i === index ? " sel" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === index));
    const ico = document.createElement("span");
    ico.className = "qk-fav";
    if (item.icon) ico.innerHTML = icon(item.icon);
    else if (item.url && /^https?:/.test(item.url)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(item.url)}&size=32`;
      img.onerror = () => { img.remove(); ico.innerHTML = icon("globe"); };
      ico.append(img);
    } else ico.innerHTML = icon(item.kind === "search" ? "search" : "globe");
    const text = document.createElement("span");
    text.className = "qk-text";
    const title = Object.assign(document.createElement("span"), { className: "qk-title", textContent: item.title });
    text.append(title);
    if (item.sub) text.append(Object.assign(document.createElement("span"), { className: "qk-sub", textContent: item.sub }));
    const tag = Object.assign(document.createElement("span"), { className: "qk-tag", textContent: KIND_LABEL[item.kind] || "" });
    li.append(ico, text, tag);
    li.onmousemove = () => { if (index !== i) { index = i; paint(); } };
    li.onclick = (e) => choose(item, e.ctrlKey || e.metaKey);
    return li;
  }

  function paint() {
    list.replaceChildren(...items.map(row));
    list.children[index]?.scrollIntoView({ block: "nearest" });
  }

  async function refresh() {
    const mine = ++seq;
    const text = input.value.trim();
    const [found, spaces] = await Promise.all([send({ type: "quick:query", q: text }).then((r) => r?.results || []).catch(() => []), workspaceItems().catch(() => [])]);
    if (mine !== seq) return;
    const q = text.toLowerCase();
    const cmds = commandList(inPage).filter((c) => !q || `${c.title} ${c.sub}`.toLowerCase().includes(q));
    const wsHits = spaces.filter((w) => !q || w.title.toLowerCase().includes(q));
    const extra = [];
    if (text) extra.push(looksLikeUrl(text) ? { kind: "url", url: toUrl(text), title: toUrl(text), sub: "이 주소로 이동", icon: "globe" } : { kind: "search", text, title: `"${text}" 검색`, sub: "기본 검색엔진" });
    const rest = [...found, ...wsHits, ...cmds.slice(0, q ? 6 : 4)];
    if (!text) items = rest.slice(0, 14);
    else if (extra[0].kind === "url") items = [extra[0], ...rest].slice(0, 14); // an address: opening it is the likely wish
    else items = [...rest.slice(0, 13), ...(rest.length ? [extra[0]] : [extra[0]])]; // a name: the matches first, "search the web" last (or alone)
    index = 0;
    paint();
  }

  async function choose(item, newTab) {
    if (!item) return;
    close();
    if (item.kind === "ws") return void send({ type: "ws:switch", id: item.id });
    if (item.kind === "cmd") return void item.run();
    send({ type: "quick:run", item: { ...item, newTab } });
  }

  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 70); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(index + 1, items.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(index - 1, 0); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[index], e.ctrlKey || e.metaKey); }
    e.stopPropagation(); // keep the page's own shortcuts out of the box
  });
  input.addEventListener("keyup", (e) => e.stopPropagation());
  input.addEventListener("keypress", (e) => e.stopPropagation());

  refresh();
  setTimeout(() => input.focus(), 0);
  return { destroy: () => { clearTimeout(timer); backdrop.remove(); }, focus: () => input.focus() };
}
