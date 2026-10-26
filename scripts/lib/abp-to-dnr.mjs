// Adblock Plus / uBlock Origin network filters -> Chrome declarativeNetRequest rules.
// Only network filters are converted. Cosmetic (##), scriptlet, html and exotic-option filters are dropped.

const TYPE_MAP = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  css: "stylesheet",
  object: "object",
  "object-subrequest": "object",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  subdocument: "sub_frame",
  frame: "sub_frame",
  ping: "ping",
  media: "media",
  font: "font",
  websocket: "websocket",
  other: "other",
  document: "main_frame",
  doc: "main_frame",
};

// Options that change behaviour in a way DNR cannot express: drop the whole rule rather than over-block.
const UNSUPPORTED = /^(csp|redirect|redirect-rule|removeparam|queryprune|rewrite|replace|popup|popunder|inline-script|inline-font|badfilter|denyallow|header|to|from|method|app|cname|empty|mp4|all|ghide|generichide|elemhide|specifichide|shide|uritransform|permissions|webrtc|beacon|1p-strict|3p-strict|content|extension|xhr-ext|stealth|network|webtransport|dnsrewrite)(=.*)?$/;

const ASCII = /^[\x21-\x7e]+$/;
const DOMAIN = /^[a-z0-9.-]+$/;

function parseOptions(raw) {
  const o = { types: [], notTypes: [], party: null, domains: [], notDomains: [], important: false, matchCase: false };
  for (let part of raw.split(",")) {
    part = part.trim().toLowerCase();
    if (!part) continue;
    if (part === "important") o.important = true;
    else if (part === "match-case") o.matchCase = true;
    else if (part === "third-party" || part === "3p") o.party = "thirdParty";
    else if (part === "~third-party" || part === "first-party" || part === "1p") o.party = "firstParty";
    else if (part.startsWith("domain=")) {
      for (const d of part.slice(7).split("|")) {
        if (!d) continue;
        const neg = d.startsWith("~");
        const name = neg ? d.slice(1) : d;
        if (!DOMAIN.test(name)) return null; // regex / entity / wildcard domains
        (neg ? o.notDomains : o.domains).push(name);
      }
    } else if (part.startsWith("~") && TYPE_MAP[part.slice(1)]) o.notTypes.push(TYPE_MAP[part.slice(1)]);
    else if (TYPE_MAP[part]) o.types.push(TYPE_MAP[part]);
    else if (UNSUPPORTED.test(part)) return null;
    else return null; // unknown option: be conservative
  }
  return o;
}

// -> { rule, kind } or null. `kind` is "domain" (||host^ style: cheap and precise) or "generic".
export function convertLine(line) {
  line = line.trim();
  if (!line || line[0] === "!" || line[0] === "[") return null;
  if (/##|#@#|#\?#|#\$#|#@\$#|#%#|\$\$/.test(line)) return null;

  let allow = false;
  if (line.startsWith("@@")) {
    allow = true;
    line = line.slice(2);
  }

  let pattern = line;
  let opts = parseOptions("");
  const dollar = line.lastIndexOf("$");
  if (dollar !== -1 && !/\/.*\$.*\/$/.test(line)) {
    pattern = line.slice(0, dollar);
    opts = parseOptions(line.slice(dollar + 1));
    if (!opts) return null;
  }

  if (!pattern || (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2)) return null; // regex
  if (!ASCII.test(pattern)) return null;
  if (pattern === "*" || pattern === "||" || pattern === "|") return null;
  if (pattern.startsWith("||*")) return null;

  const anchoredHost = /^\|\|[a-z0-9.-]+(\^|\/|$)/i.test(pattern);
  const bare = pattern.replace(/[|^*]/g, "");
  // very short unanchored patterns would match half the web
  if (!anchoredHost && bare.length < 4 && !allow) return null;

  const condition = { urlFilter: pattern };
  if (opts.matchCase) condition.isUrlFilterCaseSensitive = true;
  if (opts.types.length) {
    // Chrome rejects rules that mix resourceTypes and excludedResourceTypes: fold the exclusions in.
    const types = [...new Set(opts.types)].filter((t) => !opts.notTypes.includes(t));
    if (!types.length) return null;
    condition.resourceTypes = types;
  } else if (opts.notTypes.length) {
    condition.excludedResourceTypes = [...new Set(opts.notTypes)];
  }
  if (opts.party) condition.domainType = opts.party;
  if (opts.domains.length) condition.initiatorDomains = opts.domains;
  if (opts.notDomains.length) condition.excludedInitiatorDomains = opts.notDomains;

  // Blocking rules skip main_frame by default in DNR. A pure $document rule would be a page block: keep it as asked.
  const rule = {
    priority: allow ? 2 : opts.important ? 3 : 1,
    action: { type: allow ? "allow" : "block" },
    condition,
  };
  return { rule, kind: anchoredHost ? "domain" : "generic" };
}

export function convertList(text, { max = Infinity } = {}) {
  const seen = new Set();
  const domain = [];
  const generic = [];
  const allow = [];
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    total++;
    const r = convertLine(line);
    if (!r) continue;
    const key = JSON.stringify([r.rule.priority, r.rule.action.type, r.rule.condition]);
    if (seen.has(key)) continue;
    seen.add(key);
    (r.rule.action.type === "allow" ? allow : r.kind === "domain" ? domain : generic).push(r.rule);
  }
  // allow rules are few and must all be kept; block rules are truncated by value (domain-anchored first).
  const budget = Math.max(max - allow.length, 0);
  const blocks = [...domain, ...generic].slice(0, budget);
  const rules = [...blocks, ...allow].map((rule, i) => ({ id: i + 1, ...rule }));
  return {
    rules,
    stats: { lines: total, domain: domain.length, generic: generic.length, allow: allow.length, kept: rules.length },
  };
}
