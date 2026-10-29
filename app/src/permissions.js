// Site permission policy. Pure helpers (no Electron) so they can be tested.
const LABELS = {
  geolocation: "위치",
  notifications: "알림",
  media: "카메라/마이크",
  "clipboard-read": "클립보드 읽기",
  midi: "MIDI 기기",
  midiSysex: "MIDI 기기(시스템 전용)",
  "display-capture": "화면 공유",
  "idle-detection": "사용 상태 감지",
  "window-management": "창 관리",
  "local-fonts": "로컬 글꼴",
  popups: "팝업",
};

// the user is asked for these; everything not listed here or in ALWAYS is denied
const PROMPTED = new Set(["geolocation", "notifications", "media", "clipboard-read", "midi", "midiSysex", "display-capture", "idle-detection", "window-management", "local-fonts"]);

// harmless or required for normal pages: granted without asking
const ALWAYS = new Set(["fullscreen", "automatic-fullscreen", "clipboard-sanitized-write", "pointerLock", "keyboardLock", "screen-wake-lock", "persistent-storage", "mediaKeySystem", "storage-access", "top-level-storage-access"]);

// what the site info panel lists for every site (others appear once the user has decided on them)
const SITE_KEYS = ["geolocation", "notifications", "media", "clipboard-read", "popups"];

function label(key, details) {
  if (key === "media" && details && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1) {
    return details.mediaTypes[0] === "video" ? "카메라" : "마이크";
  }
  return LABELS[key] || key;
}

// "allow" | "deny" | "ask": the stored decision wins, then the built-in policy
function policy(key, stored) {
  if (stored === "allow" || stored === "deny") return stored;
  if (ALWAYS.has(key)) return "allow";
  return PROMPTED.has(key) ? "ask" : "deny";
}

// only real web origins can hold permissions (not fjord://, file://, about:)
function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

module.exports = { LABELS, PROMPTED, ALWAYS, SITE_KEYS, label, policy, originOf };
