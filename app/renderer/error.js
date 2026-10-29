import { icon } from "fjord://shared/icons.js";

const q = new URLSearchParams(location.search);
const kind = q.get("kind");
const url = q.get("url") || "";
const code = Number(q.get("code") || 0);
const $ = (id) => document.getElementById(id);

const LOAD = {
  [-105]: ["주소를 찾을 수 없어요", "주소에 오타가 없는지 확인하거나, 검색어로 다시 찾아 보세요."],
  [-106]: ["인터넷에 연결되어 있지 않아요", "네트워크 연결을 확인한 뒤 다시 시도하세요."],
  [-102]: ["서버가 연결을 거부했어요", "서버가 꺼져 있거나 주소/포트가 맞지 않을 수 있어요."],
  [-118]: ["응답이 너무 오래 걸려요", "잠시 후 다시 시도하세요."],
  [-7]: ["응답이 너무 오래 걸려요", "잠시 후 다시 시도하세요."],
  [-100]: ["연결이 끊어졌어요", "다시 시도해 보세요."],
  [-101]: ["연결이 끊어졌어요", "다시 시도해 보세요."],
};

let title, body, detail = "";
const actions = [];
if (kind === "cert") {
  title = "연결이 비공개로 설정되어 있지 않아요";
  body = "이 사이트의 보안 인증서를 신뢰할 수 없어요. 공격자가 비밀번호나 카드 정보 같은 내용을 가로채려는 것일 수도 있어요.";
  detail = (q.get("desc") || "") + (code ? ` (${code})` : "");
  document.title = "개인 정보 보호 오류";
  $("ico").innerHTML = icon("warning");
  $("ico").style.color = "var(--fj-color-state-danger)";
  actions.push(Object.assign(document.createElement("button"), { className: "fj-btn fj-btn--primary", textContent: "안전한 곳으로 돌아가기", onclick: () => window.fjord.cmd("safeExit") }));
  actions.push(Object.assign(document.createElement("button"), { className: "fj-btn", textContent: "안전하지 않음으로 이동", onclick: () => window.fjord.cmd("certProceed", url) }));
} else if (kind === "crash") {
  title = "페이지가 중단됐어요";
  body = "이 탭의 렌더러 프로세스가 예기치 않게 종료됐어요. 다시 불러오면 대부분 해결돼요.";
  document.title = "페이지가 중단됨";
  $("ico").innerHTML = icon("close");
} else {
  [title, body] = LOAD[code] || ["페이지를 열 수 없어요", "사이트에 연결하는 중 문제가 생겼어요."];
  detail = (q.get("desc") || "") + (code ? ` (${code})` : "");
  document.title = "연결할 수 없음";
  $("ico").innerHTML = icon("globe");
}
$("title").textContent = title;
$("body").textContent = body;
$("url").textContent = url;
$("detail").textContent = detail;
if (!actions.length) actions.push(Object.assign(document.createElement("button"), { className: "fj-btn fj-btn--primary", textContent: "다시 시도", onclick: () => window.fjord.cmd("retry", url) }));
$("actions").append(...actions);
