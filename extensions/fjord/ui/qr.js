// QR code generator, no dependencies: byte mode (UTF-8), error correction level M, versions 1-12 (up to 231 bytes: enough
// for any address). Verified by decoding the output with OpenCV (scripts/test-qr.mjs + scripts/test-qr.py).
// Layout and tables follow ISO/IEC 18004; the structure of the code follows the public-domain reference by Project Nayuki.

// version -> [error correction codewords per block, [[blocks, data codewords per block], ...]] for level M
const EC_M = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]],
  7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
  11: [30, [[1, 50], [4, 51]]], 12: [22, [[6, 36], [2, 37]]],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58] };
const MAX_VERSION = 12;

// ---- Reed-Solomon over GF(256), polynomial 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // highest power first, leading 1
}

function remainder(data, gen) {
  const rem = new Array(gen.length - 1).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < rem.length; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

// ---- encoding -------------------------------------------------------------------------------------------
function pickVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const [, blocks] = EC_M[v];
    const capacityBits = blocks.reduce((n, [count, cw]) => n + count * cw, 0) * 8;
    if (4 + (v < 10 ? 8 : 16) + byteLength * 8 <= capacityBits) return v;
  }
  throw new Error("QR: text too long (max 231 bytes)");
}

function codewords(bytes, version) {
  const [ecLen, blockSpec] = EC_M[version];
  const dataCw = blockSpec.reduce((n, [count, cw]) => n + count * cw, 0);
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCw * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = [];
  let offset = 0;
  for (const [count, cw] of blockSpec) for (let i = 0; i < count; i++) { blocks.push(data.slice(offset, offset + cw)); offset += cw; }
  const gen = generator(ecLen);
  const ecs = blocks.map((b) => remainder(b, gen));
  const out = [];
  for (let i = 0; i < Math.max(...blocks.map((b) => b.length)); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ---- matrix -----------------------------------------------------------------------------------------------
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m, size) {
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i].slice());
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    const s = line.map((v) => (v ? "1" : "0")).join("");
    for (const pat of ["10111010000", "00001011101"]) for (let at = s.indexOf(pat); at >= 0; at = s.indexOf(pat, at + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = pickVersion(bytes.length);
  const size = 17 + 4 * version;
  const base = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false)); // function modules (never masked)
  const setFn = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { base[y][x] = dark; fn[y][x] = true; } };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); } // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // finders + separators
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setFn(cx + dx, cy + dy, d !== 2 && d !== 4); }
  }
  const centers = ALIGN[version];
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(centers[i] + dx, centers[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const formatBits = (mask) => { // level M = 00
    const data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  };
  const drawFormat = (m, mask) => {
    const bits = formatBits(mask);
    const put = (x, y, dark) => { m[y][x] = dark; };
    for (let i = 0; i <= 5; i++) put(8, i, getBit(bits, i));
    put(8, 7, getBit(bits, 6));
    put(8, 8, getBit(bits, 7));
    put(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, getBit(bits, i));
    put(8, size - 8, true); // always dark
  };
  for (let i = 0; i < 15; i++) { // reserve the format areas
    const cells = [[8, i < 6 ? i : i < 8 ? i + 1 : 8], [i < 8 ? size - 1 - i : 8, i < 8 ? 8 : size - 15 + i]];
    for (const [x, y] of cells) fn[y][x] = true;
  }
  for (const [x, y] of [[8, 7], [8, 8], [7, 8], [8, size - 8]]) fn[y][x] = true;
  for (let i = 9; i < 15; i++) fn[8][14 - i] = true;

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, dark);
      setFn(b, a, dark);
    }
  }

  // data placement (zigzag from the bottom right, two columns at a time, skipping the vertical timing column)
  const data = codewords(bytes, version);
  const raw = base.map((row) => row.slice());
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < data.length * 8) { raw[y][x] = getBit(data[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
  }

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = raw.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    drawFormat(m, mask);
    const score = penalty(m, size);
    if (!best || score < best.score) best = { score, m, mask };
  }
  return { size, version, mask: best.mask, modules: best.m };
}

// SVG string (crisp edges, one path); `margin` = quiet zone in modules (the spec asks for 4)
export function qrSvg(text, { px = 6, margin = 4, dark = "#000", light = "#fff" } = {}) {
  const { size, modules } = qrMatrix(text);
  const total = size + margin * 2;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * px}" height="${total * px}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
