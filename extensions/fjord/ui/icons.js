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
};

export function icon(name, size) {
  const px = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<svg class="fj-icon" viewBox="0 0 24 24" aria-hidden="true"${px}>${PATHS[name] || ""}</svg>`;
}
