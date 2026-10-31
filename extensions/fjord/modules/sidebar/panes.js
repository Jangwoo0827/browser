// The panes of the side panel. Shared by the panel itself and the page rail (the rail opens the panel on a pane by id).
export const PANES = [
  { id: "@claude", name: "Claude", icon: "sparkles" },
  { id: "@bookmarks", name: "북마크", icon: "bookmark" },
  { id: "@history", name: "기록", icon: "history" },
  { id: "@tabs", name: "열린 탭", icon: "tabs" },
];

// embedded extension pages
export const TOOLS = [
  { id: "@workspaces", name: "워크스페이스", icon: "layers", page: "../workspaces/popup.html" },
  { id: "@adblock", name: "광고 차단", icon: "shield", page: "../adblock/popup.html" },
];

export const DEFAULT_PANE = "@claude";

export const paneById = (id) => PANES.find((p) => p.id === id);
export const toolById = (id) => TOOLS.find((t) => t.id === id);

// Claude is a pane of its own, so the pinned-site entry for claude.ai would only duplicate it
export const isClaudeSite = (item) => {
  try {
    return new URL(item.url).hostname.replace(/^www\./, "") === "claude.ai";
  } catch {
    return false;
  }
};
