// Download the public filter lists and convert them into declarativeNetRequest rulesets.
// Usage: node scripts/update-filters.mjs [--offline <dir-with-id.txt-files>]
// Output: extensions/adblock/rules/<id>.json + rules/meta.json (generated, not committed).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertList } from "./lib/abp-to-dnr.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "extensions", "adblock", "rules");

// `max` keeps each list under a sane size (domain-anchored rules are kept first). Chrome guarantees 30,000
// static rules per extension and shares 330,000 across all extensions, so these fit while few other
// extensions with big rulesets are installed.
export const LISTS = [
  { id: "easylist", name: "EasyList (광고)", url: "https://easylist.to/easylist/easylist.txt", max: 60000 },
  { id: "easyprivacy", name: "EasyPrivacy (추적)", url: "https://easylist.to/easylist/easyprivacy.txt", max: 60000 },
  {
    id: "listkr",
    name: "List-KR (한국)",
    url: "https://cdn.jsdelivr.net/npm/@list-kr/filterslists@latest/dist/filterslist-uBlockOrigin.txt",
    max: 20000,
  },
];

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const offlineIdx = process.argv.indexOf("--offline");
const offlineDir = offlineIdx !== -1 ? process.argv[offlineIdx + 1] : null;

await mkdir(outDir, { recursive: true });
const meta = { updated: new Date().toISOString(), lists: [] };

for (const list of LISTS) {
  const text = offlineDir ? await readFile(join(offlineDir, `${list.id}.txt`), "utf8") : await fetchText(list.url);
  const { rules, stats } = convertList(text, { max: list.max });
  await writeFile(join(outDir, `${list.id}.json`), JSON.stringify(rules));
  meta.lists.push({ id: list.id, name: list.name, rules: rules.length, stats });
  console.log(`${list.id}: ${rules.length} rules (domain ${stats.domain}, generic ${stats.generic}, allow ${stats.allow})`);
}

await writeFile(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log("done");
