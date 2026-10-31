const $ = id => document.getElementById(id);
const LIST_NAMES = { easylist: 'EasyList', easyprivacy: 'EasyPrivacy', hagezi: 'HaGeZi Pro' };
const fmt = n => (n || 0).toLocaleString();

function renderEnabled(enabled) {
  $('toggle').checked = enabled;
  document.body.classList.toggle('off', !enabled);
  $('status').textContent = enabled ? '보호 중' : '모든 사이트에서 일시중지';
}

function renderStats(stats) {
  const { network = 0, cosmetic = 0, youtube = 0 } = stats || {};
  $('total').textContent = fmt(network + cosmetic + youtube);
  $('network').textContent = fmt(network);
  $('cosmetic').textContent = fmt(cosmetic);
  $('youtube').textContent = fmt(youtube);
}

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

function renderMeta(meta) {
  const lists = $('lists');
  lists.textContent = '';
  for (const [id, name] of Object.entries(LIST_NAMES)) {
    const info = meta?.lists?.[id];
    const row = document.createElement('div');
    row.className = 'list';
    const left = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'dot' + (info ? (info.ok ? ' ok' : ' err') : '');
    left.append(dot, name);
    const right = document.createElement('span');
    right.className = 'n';
    right.textContent = !info ? '—' : info.ok
      ? `요청 ${fmt(info.network)} · 요소 ${fmt(info.cosmetic)}`
      : '실패';
    if (info && !info.ok) right.title = info.error;
    row.append(left, right);
    lists.append(row);
  }
  $('meta').textContent = meta
    ? `규칙 ${fmt(meta.networkRules)} + 도메인 ${fmt(meta.blockedDomains)} · ${timeAgo(meta.updatedAt)} 업데이트`
    : '아직 받지 않았어요 — 설치 후 자동으로 받아요.';
}

function setUpdating(on) {
  $('update').disabled = on;
  $('update').textContent = on ? '업데이트 중…' : '목록 업데이트';
}

chrome.storage.local.get({ enabled: true, stats: null, meta: null }, ({ enabled, stats, meta }) => {
  renderEnabled(enabled);
  renderStats(stats);
  renderMeta(meta);
});

chrome.runtime.sendMessage({ type: 'isUpdating' }, res => {
  if (!chrome.runtime.lastError && res?.updating) setUpdating(true);
});

$('toggle').addEventListener('change', () => {
  chrome.storage.local.set({ enabled: $('toggle').checked });
  renderEnabled($('toggle').checked);
});

// Optional rulesets: checkbox id -> storage key (both default on)
const OPTIONS = { consent: 'blockConsent', strict: 'blockStrict' };
chrome.storage.local.get({ blockConsent: true, blockStrict: true }, data => {
  for (const [id, key] of Object.entries(OPTIONS)) $(id).checked = data[key];
});
for (const [id, key] of Object.entries(OPTIONS)) {
  $(id).addEventListener('change', () => chrome.storage.local.set({ [key]: $(id).checked }));
}

// ---- Per-site switch for the active tab ----
let siteTab = null;
let siteHost = null;   // stored form: hostname without a leading "www."

function renderSite(disabledSites) {
  const off = disabledSites.some(d => siteHost === d || siteHost.endsWith('.' + d));
  $('siteToggle').checked = !off;
  $('siteCard').classList.toggle('off', off);
  $('siteStatus').textContent = off ? '이 사이트에서는 꺼져 있어요 — 아무것도 차단하지 않아요' : '이 사이트에서 차단 중';
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  let url;
  try { url = new URL(tab.url); } catch (_) { return; }
  if (!/^https?:$/.test(url.protocol)) return; // chrome://, file://, new tab…
  siteTab = tab;
  siteHost = url.hostname.replace(/^www\./, '');
  $('siteName').textContent = siteHost;
  $('siteCard').hidden = false;
  chrome.storage.local.get({ disabledSites: [] }, ({ disabledSites }) => renderSite(disabledSites));
});

$('siteToggle').addEventListener('change', () => {
  chrome.storage.local.get({ disabledSites: [] }, ({ disabledSites }) => {
    const on = $('siteToggle').checked;
    // Turning back on removes the entry and any parent domain that covered this host
    const next = on
      ? disabledSites.filter(d => !(siteHost === d || siteHost.endsWith('.' + d)))
      : [...new Set([...disabledSites, siteHost])];
    chrome.storage.local.set({ disabledSites: next }, () => {
      renderSite(next);
      // Rules apply to new page loads; give the background a moment to swap them, then reload
      setTimeout(() => chrome.tabs.reload(siteTab.id), 300);
    });
  });
});

$('update').addEventListener('click', () => {
  setUpdating(true);
  chrome.runtime.sendMessage({ type: 'update' }, res => {
    setUpdating(false);
    if (chrome.runtime.lastError || !res?.ok) {
      $('meta').textContent = '업데이트 실패: ' + (res?.error || chrome.runtime.lastError?.message || '알 수 없는 오류');
    }
  });
});

$('reset').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'resetStats' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) renderEnabled(changes.enabled.newValue);
  if (changes.stats) renderStats(changes.stats.newValue);
  if (changes.meta) { renderMeta(changes.meta.newValue); setUpdating(false); }
});
