import { icon, WORKSPACE_ICONS } from "../../ui/icons.js";

const $ = (id) => document.getElementById(id);
let editing = null;

const send = (msg) => chrome.runtime.sendMessage({ ...msg, type: "ws:" + msg.type });

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

function say(res) {
  $("msg").textContent = (res && res.error) || "";
}

function row(ws, activeId) {
  const li = document.createElement("li");
  const active = ws.id === activeId;
  li.className = "fj-row" + (active ? " fj-row--active" : "");

  // click the icon to cycle through the available icons
  const ico = document.createElement("button");
  ico.type = "button";
  ico.className = "ws-icon";
  ico.title = "아이콘 바꾸기";
  ico.innerHTML = icon(ws.icon || "home");
  ico.onclick = async (e) => {
    e.stopPropagation();
    const next = WORKSPACE_ICONS[(WORKSPACE_ICONS.indexOf(ws.icon) + 1) % WORKSPACE_ICONS.length];
    say(await send({ type: "icon", id: ws.id, icon: next }));
    refresh();
  };
  li.append(ico);

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
        say(await send({ type: "rename", id: ws.id, name: input.value }));
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
  li.append(name, count);
  if (!active) {
    li.append(
      iconButton("arrowRight", "지금 탭을 이 워크스페이스로 옮기기", async () => {
        say(await send({ type: "moveTab", id: ws.id }));
        refresh();
      })
    );
  }
  li.append(
    iconButton("edit", "이름 변경", () => {
      editing = ws.id;
      refresh();
    }),
    iconButton("close", "삭제 (탭은 첫 워크스페이스로 이동)", async () => {
      say(await send({ type: "delete", id: ws.id }));
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
  say(res);
  if (!res || !res.error) $("name").value = "";
  refresh();
};

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "local") refresh();
});

refresh();
