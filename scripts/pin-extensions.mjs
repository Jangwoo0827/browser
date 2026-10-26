// Pin extensions to the toolbar by editing the profile's Preferences (extensions.pinned_extensions).
// Only run while the browser is NOT running (it rewrites Preferences on exit).
// Usage: node scripts/pin-extensions.mjs <profile-dir> <extension-id>...
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [profileDir, ...ids] = process.argv.slice(2);
if (!profileDir || ids.length === 0) {
  console.error("usage: pin-extensions.mjs <profile-dir> <id>...");
  process.exit(2);
}

const file = join(profileDir, "Default", "Preferences");
if (!existsSync(file)) {
  console.log("no Preferences yet (first run); skipping pin");
  process.exit(0);
}

const prefs = JSON.parse(await readFile(file, "utf8"));
prefs.extensions ??= {};
const pinned = Array.isArray(prefs.extensions.pinned_extensions) ? prefs.extensions.pinned_extensions : [];
const missing = ids.filter((id) => !pinned.includes(id));
if (missing.length === 0) {
  console.log("already pinned");
  process.exit(0);
}
prefs.extensions.pinned_extensions = [...pinned, ...missing];
await writeFile(file, JSON.stringify(prefs));
console.log(`pinned: ${missing.join(", ")}`);
