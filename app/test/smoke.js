// Smoke test: runs the real app with a hidden window (never pops anything on the desktop), drives the commands
// and saves screenshots to ../logs. Usage: npm run smoke
process.env.FJORD_TEST = "1";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
process.env.FJORD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fjord-smoke-"));

const { app } = require("electron");
require("../src/main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(logs, { recursive: true });
const checks = [];
const check = (name, ok, extra) => { checks.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); };

async function shot(webContents, file) {
  let lastError;
  for (let i = 0; i < 8; i++) { // the surface of a freshly shown window is not always ready
    try {
      const img = await webContents.capturePage();
      if (!img.isEmpty()) {
        fs.writeFileSync(path.join(logs, file), img.toPNG());
        return img.getSize();
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(500);
  }
  throw lastError || new Error("empty capture");
}

app.whenReady().then(async () => {
  try {
    await sleep(2500);
    const f = global.__fjord;
    let s = f.serialize();
    check("starts with a new tab in the first workspace", s.tabs.length === 1 && s.tabs[0].isNewTab && s.activeWs === "personal", { ws: s.activeWs, tabs: s.tabs.length });

    f.commands.newTab("data:text/html,<title>Hello Fjord</title><body style='background:%23264;color:%23fff;font:32px sans-serif'><h1>Hello Fjord</h1>");
    await sleep(1200);
    s = f.serialize();
    check("opening a page adds an active tab with its title", s.tabs.length === 2 && s.tabs[1].title === "Hello Fjord" && s.activeTab === s.tabs[1].id, s.tabs.map((t) => t.title || (t.isNewTab ? "(new tab)" : t.url)));

    f.commands.newTab("data:text/html,<title>Second</title><body style='background:%23623;color:%23fff;font:32px sans-serif'><h1>Second</h1>");
    await sleep(1000);
    check("three tabs", f.serialize().tabs.length === 3);

    f.commands.wsSwitch("work");
    await sleep(1200);
    s = f.serialize();
    check("switching workspace shows that workspace's own tabs", s.activeWs === "work" && s.tabs.length === 1 && s.tabs[0].isNewTab, { ws: s.activeWs, tabs: s.tabs.length });
    check("the workspace counts are kept", s.workspaces.find((w) => w.id === "personal").count === 3);

    f.commands.wsSwitch("personal");
    await sleep(800);
    s = f.serialize();
    check("back in the first workspace the old tabs are still there", s.tabs.length === 3 && s.activeWs === "personal");

    const target = s.tabs[1].id;
    f.commands.moveTab({ id: target, ws: "work" });
    await sleep(600);
    check("moving a tab to another workspace", f.serialize().tabs.length === 2 && f.store.tabsOf("work").list.length === 2);

    f.commands.closeTab(f.serialize().activeTab);
    await sleep(500);
    check("closing a tab selects a neighbour", f.serialize().tabs.length === 1 && !!f.serialize().activeTab);

    const addRes = f.commands.wsAdd("공부");
    await sleep(800);
    s = f.serialize();
    check("adding a workspace switches to it with a fresh tab", !addRes.error && s.workspaces.length === 3 && s.tabs.length === 1);

    // persistence
    f.store.save(true);
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.FJORD_USER_DATA, "state.json"), "utf8"));
    check("state is written to disk", saved.workspaces.length === 3 && Object.keys(saved.tabs).length >= 2);

    f.commands.wsSwitch("personal");
    await sleep(1000);
    // capturing needs a shown window: make it fully transparent, off the taskbar and unfocused so nothing is visible
    const w = f.win();
    w.setSkipTaskbar(true);
    w.setOpacity(0);
    w.showInactive();
    await sleep(1200);
    const uiSize = await shot(f.ui().webContents, "app-ui.png");
    const viewSize = await shot(f.views.get(f.attached()).webContents, "app-content.png");
    w.hide();
    check("screenshots captured", uiSize.width > 100 && viewSize.width > 100, { ui: uiSize, content: viewSize });
  } catch (e) {
    check("no exception", false, String(e && e.stack || e));
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${checks.length} checks passed`);
  app.exit(failed ? 1 : 0);
});
