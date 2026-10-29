// Deep-merge a JSON patch into the profile's Preferences (only while the browser is NOT running; it rewrites the file on exit).
// Usage: node scripts/apply-prefs.mjs <profile-dir> '<json patch>'
//   e.g. node scripts/apply-prefs.mjs C:\profile '{"vertical_tabs":{"enabled":true}}'
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [profileDir, patchJson] = process.argv.slice(2);
if (!profileDir || !patchJson) {
  console.error("usage: apply-prefs.mjs <profile-dir> '<json patch>'");
  process.exit(2);
}
const file = join(profileDir, "Default", "Preferences");
if (!existsSync(file)) {
  console.log("no Preferences yet (first run); skipping");
  process.exit(0);
}

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(target, patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v)) {
      if (!isObject(target[k])) {
        target[k] = {};
        changed = true;
      }
      changed = merge(target[k], v) || changed;
    } else if (JSON.stringify(target[k]) !== JSON.stringify(v)) {
      target[k] = v;
      changed = true;
    }
  }
  return changed;
}

const prefs = JSON.parse(await readFile(file, "utf8"));
// PowerShell 5.1 mangles double quotes in native args, so the launcher passes the patch as "b64:<base64 of the JSON>"
const patch = patchJson.startsWith("b64:") ? Buffer.from(patchJson.slice(4), "base64").toString("utf8") : patchJson;
if (merge(prefs, JSON.parse(patch))) {
  await writeFile(file, JSON.stringify(prefs));
  console.log("preferences updated");
} else {
  console.log("preferences already set");
}
