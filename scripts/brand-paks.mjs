// Replace the product name "Chromium" in the locale string packs (window title suffix, About page, menus ...).
// Pack v5 layout: 12-byte header {version u32, encoding u8, pad[3], resources u16, aliases u16},
// (resources+1) x {id u16, offset u32}, aliases x {id u16, resource index u16}, then the data blob.
// Originals are kept once as <file>.orig, so a rerun always starts from the untouched pack.
// Usage: node scripts/brand-paks.mjs <chrome-win dir> <product name>
import { copyFile, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [dir, name] = process.argv.slice(2);
if (!dir || !name) {
  console.error("usage: brand-paks.mjs <chrome-win dir> <product name>");
  process.exit(2);
}

const FROM = Buffer.from("Chromium", "utf8");
const TO = Buffer.from(name, "utf8");

function replaceAll(buf) {
  const parts = [];
  let pos = 0;
  let idx;
  let changed = 0;
  while ((idx = buf.indexOf(FROM, pos)) !== -1) {
    parts.push(buf.subarray(pos, idx), TO);
    pos = idx + FROM.length;
    changed++;
  }
  if (!changed) return { buf, changed: 0 };
  parts.push(buf.subarray(pos));
  return { buf: Buffer.concat(parts), changed };
}

function rebuild(orig) {
  const version = orig.readUInt32LE(0);
  const encoding = orig[4];
  if (version !== 5 || encoding !== 1) return null; // only plain UTF-8 v5 packs
  const count = orig.readUInt16LE(8);
  const aliases = orig.readUInt16LE(10);
  const tableStart = 12;
  const entries = [];
  for (let i = 0; i <= count; i++) {
    entries.push({ id: orig.readUInt16LE(tableStart + i * 6), off: orig.readUInt32LE(tableStart + i * 6 + 2) });
  }
  const aliasStart = tableStart + (count + 1) * 6;
  const aliasBytes = orig.subarray(aliasStart, aliasStart + aliases * 4);

  let total = 0;
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const r = replaceAll(orig.subarray(entries[i].off, entries[i + 1].off));
    total += r.changed;
    blobs.push(r.buf);
  }
  if (total === 0) return { out: null, total: 0 };

  const header = Buffer.from(orig.subarray(0, 12));
  const dataStart = aliasStart + aliases * 4;
  const table = Buffer.alloc((count + 1) * 6);
  let off = dataStart;
  for (let i = 0; i < count; i++) {
    table.writeUInt16LE(entries[i].id, i * 6);
    table.writeUInt32LE(off, i * 6 + 2);
    off += blobs[i].length;
  }
  table.writeUInt16LE(entries[count].id, count * 6);
  table.writeUInt32LE(off, count * 6 + 2);
  return { out: Buffer.concat([header, table, aliasBytes, ...blobs]), total };
}

const localeDir = join(dir, "locales");
const stampFile = join(dir, "pak-brand.txt");
const exe = await stat(join(dir, "chrome.exe"));
const signature = JSON.stringify({ name, exe: exe.size, mtime: exe.mtimeMs });
if (existsSync(stampFile) && (await readFile(stampFile, "utf8")) === signature) {
  console.log("packs up to date");
  process.exit(0);
}

let files = 0;
let replaced = 0;
for (const f of await readdir(localeDir)) {
  if (!f.endsWith(".pak")) continue;
  const p = join(localeDir, f);
  const backup = p + ".orig";
  if (!existsSync(backup)) await copyFile(p, backup);
  const res = rebuild(await readFile(backup));
  if (!res) continue;
  if (res.out) {
    await writeFile(p, res.out);
    files++;
    replaced += res.total;
  } else {
    await copyFile(backup, p);
  }
}
await writeFile(stampFile, signature);
console.log(`branded ${files} locale packs (${replaced} strings)`);
