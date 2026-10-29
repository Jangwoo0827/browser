// Inline SVG icons (24px grid, 2px round stroke) shared by the UI modules. Colour comes from currentColor.
const PATHS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  collapse: '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  external: '<path d="M7 17 17 7M8 7h9v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  gamepad: '<path d="M6 11h4M8 9v4"/><circle cx="15" cy="12" r="1"/><circle cx="18" cy="10" r="1"/><path d="M17.3 5H6.7a4 4 0 0 0-3.9 3.1L2 17a2 2 0 0 0 3.4 1.6L8 16h8l2.6 2.6A2 2 0 0 0 22 17l-.8-8.9A4 4 0 0 0 17.3 5z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  star: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/>',
  heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

// icons a workspace can use (cycled by clicking the icon in the workspaces page)
export const WORKSPACE_ICONS = ["home", "briefcase", "gamepad", "book", "star", "heart", "code", "globe"];

export function icon(name, size) {
  const px = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<svg class="fj-icon" viewBox="0 0 24 24" aria-hidden="true"${px}>${PATHS[name] || ""}</svg>`;
}
