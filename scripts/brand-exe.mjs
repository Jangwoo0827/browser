// Make a branded copy of chrome.exe (<name>.exe) with our icon and name, so the taskbar / Task Manager show the
// product instead of "Chromium". The original chrome.exe is left untouched; the copy is redone after each snapshot update.
// Usage: node scripts/brand-exe.mjs <chrome-win dir> <product name> <icon.png (256px)>
import { copyFile, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const [dir, name, icon] = process.argv.slice(2);
if (!dir || !name || !icon) {
  console.error("usage: brand-exe.mjs <chrome-win dir> <product name> <icon.png (256px)>");
  process.exit(2);
}

import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const toolsDir = join(homedir(), "BrowserProject", "tools");
const rcedit = join(toolsDir, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
if (!existsSync(rcedit)) {
  console.log("installing rcedit into", toolsDir);
  execFileSync("npm", ["i", "rcedit@4", "--no-audit", "--no-fund", "--prefix", toolsDir], { stdio: "inherit", shell: true });
}

const src = join(dir, "chrome.exe");
const dst = join(dir, `${name.toLowerCase()}.exe`);
const stamp = join(dir, `${name.toLowerCase()}.exe.brand`);

// Re-brand when the snapshot changed (size/mtime of chrome.exe) or the icon/name changed.
const srcStat = await stat(src);
const iconStat = await stat(icon);
const signature = JSON.stringify({ size: srcStat.size, mtime: srcStat.mtimeMs, name, icon: iconStat.mtimeMs });
if (existsSync(dst) && existsSync(stamp) && (await readFile(stamp, "utf8")) === signature) {
  console.log("branded exe up to date");
  process.exit(0);
}

await copyFile(src, dst);
execFileSync(
  rcedit,
  [
    dst,
    "--set-version-string", "FileDescription", name,
    "--set-version-string", "ProductName", name,
    "--set-version-string", "InternalName", name,
    "--set-version-string", "OriginalFilename", `${name.toLowerCase()}.exe`,
    "--set-version-string", "CompanyName", name,
  ],
  { stdio: "inherit" }
);
// Chromium's icon groups have string names, which rcedit cannot replace: do the main icon ourselves.
execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "set-exe-icon.ps1"), "-Exe", dst, "-Png", icon], { stdio: "inherit" });
await writeFile(stamp, signature);
console.log(`branded ${dst}`);
