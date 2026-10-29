// Colour for the letter avatar shown when a site has no favicon: known brands first, otherwise a hue from the name.
const BRANDS = { "claude.ai": "#d97757", "google.com": "#4285f4", "github.com": "#24292f", "youtube.com": "#ff0033", "naver.com": "#03c75a" };

export function glyphColor(name, url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [domain, color] of Object.entries(BRANDS)) if (host === domain || host.endsWith("." + domain)) return color;
  } catch {}
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return `hsl(${hue} 52% 42%)`;
}
