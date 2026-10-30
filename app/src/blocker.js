// Host-based ad/tracker blocker. Filter lists in Adblock syntax contribute their plain "||host^" lines; everything else
// (cosmetic rules, path patterns, regexes) is ignored. Pure module: no Electron, so it can be tested directly.
const fs = require("node:fs");
const path = require("node:path");

const PLAIN = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z0-9-]+)\^$/i;
// rule files shared with the Chromium-track extension; "strict" and "consent" are opt-in there and skipped here
const BUNDLED = ["baseline.json", "trackers.json"];

class Blocker {
  constructor() {
    this.domains = new Set();
    this.exceptions = new Set();
  }

  get size() {
    return this.domains.size;
  }

  addDomains(list) {
    for (const d of list) this.domains.add(String(d).toLowerCase());
  }

  // returns how many block entries were added
  parseList(text) {
    let added = 0;
    for (const raw of String(text).split("\n")) {
      const line = raw.trim();
      if (!line || line[0] === "!" || line[0] === "[") continue;
      if (line.startsWith("@@")) {
        const m = PLAIN.exec(line.slice(2));
        if (m) this.exceptions.add(m[1].toLowerCase());
        continue;
      }
      const m = PLAIN.exec(line);
      if (m) {
        this.domains.add(m[1].toLowerCase());
        added++;
      }
    }
    return added;
  }

  // same as parseList, but hands the thread back every few thousand lines (a full list takes ~1 s)
  async parseListAsync(text) {
    const lines = String(text).split("\n");
    let added = 0;
    for (let i = 0; i < lines.length; i += 20000) {
      added += this.parseList(lines.slice(i, i + 20000).join("\n"));
      await new Promise((r) => setImmediate(r));
    }
    return added;
  }

  // DNR-style rule files: take the plain "block" rules that list requestDomains
  loadRuleFiles(dir) {
    let n = 0;
    for (const file of BUNDLED) {
      let rules = [];
      try {
        rules = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch {}
      for (const r of rules) {
        if (r.action && r.action.type === "block" && r.condition && Array.isArray(r.condition.requestDomains) && !r.condition.excludedInitiatorDomains) {
          this.addDomains(r.condition.requestDomains);
          n += r.condition.requestDomains.length;
        }
      }
    }
    return n;
  }

  // the host or one of its parent domains is listed (and not excepted)
  matches(host) {
    for (let h = String(host).toLowerCase(); h; ) {
      if (this.exceptions.has(h)) return false;
      if (this.domains.has(h)) return true;
      const i = h.indexOf(".");
      if (i < 0) return false;
      h = h.slice(i + 1);
    }
    return false;
  }
}

// same site for our purposes: one host is the other or a subdomain of it
function sameSite(a, b) {
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

module.exports = { Blocker, sameSite };
