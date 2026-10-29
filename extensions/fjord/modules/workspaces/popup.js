import { icon } from "../../ui/icons.js";

const $ = (id) => document.getElementById(id);
let windowId;
let editing = null;

const send = (msg) => chrome.runtime.sendMessage({ ...msg, type: "ws:" + msg.type, windowId });

function iconButton(name, title, fn) {
  const b = document.createElement("button");
  b.className = "row-btn";
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = icon(name);
  b.onclick = (e) => {
    e.stopPropagation();
    fn();
  };
  return b;
}

function row(ws, activeId) {
  const li = document.createElement("li");
  li.className = "fj-row" + (ws.id === activeId ? " fj-row--active" : "");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = `var(--ws-${ws.color}, var(--fj-color-accent-primary))`;
  li.append(dot);

  if (editing === ws.id) {
    const input = document.createElement("input");
    input.className = "fj-field";
    input.value = ws.name;
    input.maxLength = 24;
    input.onclick = (e) => e.stopPropagation();
    input.onkeydown = async (e) => {
      if (e.key === "Escape") {
        editing = null;
        refresh();
      } else if (e.key === "Enter") {
        const res = await send({ type: "rename", id: ws.id, name: input.value });
        $("msg").textContent = (res && res.error) || "";
        editing = null;
        refresh();
      }
    };
    li.append(input);
    queueMicrotask(() => input.focus());
    return li;
  }

  const name = document.createElement("span");
  name.className = "fj-row__grow";
  name.textContent = ws.name;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = ws.count;
  li.append(
    name,
    count,
    iconButton("edit", "이름 변경", () => {
      editing = ws.id;
      refresh();
    }),
    iconButton("close", "삭제 (탭은 첫 워크스페이스로 이동)", async () => {
      const res = await send({ type: "delete", id: ws.id });
      $("msg").textContent = (res && res.error) || "";
      refresh();
    })
  );
  li.onclick = async () => {
    await send({ type: "switch", id: ws.id });
    refresh();
  };
  return li;
}

async function refresh() {
  const st = await send({ type: "state" });
  $("list").replaceChildren(...st.workspaces.map((w) => row(w, st.activeId)));
}

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const res = await send({ type: "add", name: $("name").value });
  $("msg").textContent = (res && res.error) || "";
  if (!res || !res.error) $("name").value = "";
  refresh();
};

(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  refresh();
})();
