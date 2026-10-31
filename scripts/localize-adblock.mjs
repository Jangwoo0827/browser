// Korean UI strings for the ad blocker popup. The module is a synced copy of an English stand-alone extension
// (see sync-adblock.mjs), so the translation is a patch applied after every sync.
// Usage: node scripts/localize-adblock.mjs   (also called by sync-adblock.mjs)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const HTML = [
  ['<html lang="en">', '<html lang="ko">'],
  ["<title>Ad Skipper</title>", "<title>광고 차단</title>"],
  ["<h1>Ad Skipper &amp; Blocker</h1>", "<h1>광고 · 추적 차단</h1>"],
  ["Protection is on", "보호 중"],
  ['title="Turn blocking on/off for this site"', 'title="이 사이트에서 차단 켜기/끄기"'],
  ['title="Turn blocking on/off"', 'title="차단 켜기/끄기"'],
  ["Blocking on this site", "이 사이트에서 차단 중"],
  ["ads &amp; trackers stopped", "차단한 광고·추적기"],
  ["<span>Requests</span>", "<span>요청</span>"],
  ["<span>Elements</span>", "<span>요소</span>"],
  ["<h2>Filter lists</h2>", "<h2>필터 목록</h2>"],
  ["Not downloaded yet", "아직 받지 않았어요"],
  ["<b>Block cookie banners &amp; A/B tests</b>", "<b>쿠키 배너·A/B 테스트 차단</b>"],
  ["Consent popups, Optimizely, LaunchDarkly… may break a few sites", "동의 팝업, Optimizely, LaunchDarkly 등 — 일부 사이트가 깨질 수 있어요"],
  ["<b>Strict mode</b>", "<b>엄격 모드</b>"],
  ['Blocks YouTube/Facebook/Instagram APIs &amp; JW Player off their own sites — embeds and "Log in with Facebook" may break', 'YouTube/Facebook/Instagram API와 JW Player를 해당 사이트 밖에서 차단해요 — 임베드와 "Facebook으로 로그인"이 깨질 수 있어요'],
  [">Update lists<", ">목록 업데이트<"],
  [">Reset stats<", ">통계 초기화<"],
];

const JS = [
  ["'Protection is on'", "'보호 중'"],
  ["'Paused on all sites'", "'모든 사이트에서 일시중지'"],
  ["'just now'", "'방금'"],
  ["`${m} min ago`", "`${m}분 전`"],
  ["`${h} h ago`", "`${h}시간 전`"],
  ["`${Math.round(h / 24)} days ago`", "`${Math.round(h / 24)}일 전`"],
  ["`${fmt(info.network)} net · ${fmt(info.cosmetic)} css`", "`요청 ${fmt(info.network)} · 요소 ${fmt(info.cosmetic)}`"],
  ["      : 'failed';", "      : '실패';"],
  ["`${fmt(meta.networkRules)} rules + ${fmt(meta.blockedDomains)} domains · updated ${timeAgo(meta.updatedAt)}`", "`규칙 ${fmt(meta.networkRules)} + 도메인 ${fmt(meta.blockedDomains)} · ${timeAgo(meta.updatedAt)} 업데이트`"],
  ["'Not downloaded yet — lists fetch automatically after install.'", "'아직 받지 않았어요 — 설치 후 자동으로 받아요.'"],
  ["'Updating…'", "'업데이트 중…'"],
  ["'Update lists'", "'목록 업데이트'"],
  ["'Off on this site — nothing is blocked here'", "'이 사이트에서는 꺼져 있어요 — 아무것도 차단하지 않아요'"],
  ["'Blocking on this site'", "'이 사이트에서 차단 중'"],
  ["'Update failed: '", "'업데이트 실패: '"],
  ["'unknown error'", "'알 수 없는 오류'"],
];

export async function localizeAdblock(dst = join(root, "extensions", "fjord", "modules", "adblock")) {
  for (const [file, table] of [["popup.html", HTML], ["popup.js", JS]]) {
    const p = join(dst, file);
    let s = await readFile(p, "utf8");
    for (const [from, to] of table) {
      if (!s.includes(from)) throw new Error(`${file}: expected text not found: ${from}`);
      s = s.split(from).join(to);
    }
    await writeFile(p, s);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await localizeAdblock();
  console.log("adblock popup localized (ko)");
}
