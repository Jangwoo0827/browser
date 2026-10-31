// Favicon lookup for extension pages. Chrome's favicon cache (the "favicon" permission) only knows sites that were visited,
// and for the others it happily returns a generic globe, which looks like a real icon. So: ask the cache, compare the answer
// with the globe, and fall back to the site's own /favicon.ico. The result also says whether the icon is (almost) white, so a
// light logo (GitHub's dark-mode icon) can be put on a dark tile instead of vanishing on a white one.
const cache = new Map();
const globes = new Map(); // size -> pixels of the generic globe Chrome returns for unknown sites

const chromeFavicon = (url, size) => `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=${size}`;

const load = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

function pixels(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, 16, 16);
  return x.getImageData(0, 0, 16, 16).data;
}

async function globePixels(size) {
  if (!globes.has(size)) {
    const img = await load(chromeFavicon("https://fjord-no-such-site.invalid/", size)); // same size as the real request, so the scaling matches
    globes.set(size, img ? pixels(img) : new Uint8ClampedArray(0));
  }
  return globes.get(size);
}

function sameImage(a, b) {
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let k = 0; k < a.length; k++) diff += Math.abs(a[k] - b[k]);
  return diff / (a.length / 4) < 12; // mean difference per pixel over the 4 channels
}

function lightness(data) {
  let sum = 0;
  let weight = 0;
  for (let k = 0; k < data.length; k += 4) {
    const a = data[k + 3];
    if (a < 40) continue;
    sum += (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]) * a;
    weight += a;
  }
  return weight ? sum / weight : 0;
}

async function lookup(url, size) {
  const fromChrome = await load(chromeFavicon(url, size));
  if (fromChrome) {
    const data = pixels(fromChrome);
    if (!sameImage(data, await globePixels(size))) return { src: fromChrome.src, light: lightness(data) > 205 };
  }
  try {
    const direct = await load(new URL(url).origin + "/favicon.ico");
    if (direct && direct.naturalWidth > 1) return { src: direct.src, light: false };
  } catch {}
  return null; // nothing usable: the caller shows a letter avatar
}

// -> Promise<{ src, light } | null>, cached per site
export function resolveFavicon(url, size = 64) {
  let origin = url;
  try { origin = new URL(url).origin; } catch {}
  const key = origin + "@" + size;
  if (!cache.has(key)) cache.set(key, lookup(url, size));
  return cache.get(key);
}
