# Progress

## 프롬프트 0 — 프로젝트 규칙 ✅ (2026-10-26)
- 한 일: `CLAUDE.md` 작성, 폴더 구조(docs/scripts/patches/extensions/logs) 정리, 자체 git 저장소 + GitHub 원격 생성.
- 남은 일: 없음.

## 프롬프트 1 — 빌드 없이 Claude 확장 검증 ✅ (2026-10-26, 사용자 확인: 웹스토어/로그인/사이드 패널/탭 읽기·클릭 모두 정상)
- 한 일:
  - OS/하드웨어 확인: Windows 11 x64, RAM 15.7GB, 12스레드, C: 여유 ~93GB, VS 2022 BuildTools 설치됨.
  - 공식 snapshot 버킷에서 Win_x64 `chrome-win.zip`(약 370MB, r1726626) 확인.
  - `scripts/run-test-chromium.ps1`: 스냅샷 다운로드 + 별도 프로필 실행.
  - `docs/claude-extension-test.md`: 체크리스트 + 결과 표.
- 스냅샷 다운로드/실행은 사용자 승인 후 진행(logs/snapshot-download.log). 남은 일: 웹스토어에서 Claude 확장 설치 → 체크리스트/결과 표 기록 → 결과 공유.
- 결과: 항목 1~13 모두 O (docs/claude-extension-test.md). 14(Claude Code /chrome 연결)·15는 프롬프트 6에서 확인.
- 알려진 문제: 없음.

## 방향 전환 (2026-10-26)
- 디스크(~93GB)/RAM(15.7GB) 한계로 소스 빌드 대신 **스냅샷 Chromium + 번들 확장 + 런처** 방식 채택. 상세: `docs/build-plan.md`.
- 프롬프트 2(소스 fetch/빌드)는 보류. 프롬프트 3~7은 확장/런처 기준으로 재해석.
- 알려진 문제: 상시 왼쪽 아이콘 줄/탭 스트립 변경은 확장으로 불가. `--load-extension`이 이 스냅샷에서 동작하는지 검증 필요.

## 스냅샷 실행 메모 (2026-10-26)
- 스냅샷 r1726626(Chromium 158.0.8124.0, 압축 해제 ~830MB)을 `%USERPROFILE%\BrowserProject\chromium-snapshot`에 설치. 다운로드는 중간에 끊겨 `curl.exe -C -`(이어받기)로 교체.
- `%LOCALAPPDATA%`에 두면 Claude 데스크톱 앱(MSIX)에서 경로가 가상화됨 → 경로를 `%USERPROFILE%`로 변경.
- Claude 앱 안(샌드박스된 도구)에서 띄우면 `Sandbox cannot access executable ... chrome.exe (0x5)`, 네트워크 서비스 크래시가 발생 → **직접 `scripts/run-test-chromium.cmd` 더블클릭으로 실행**해서 검증할 것.
- 관찰: 시작 로그에 `HKCU\Software\Google\Chrome\Extensions\fcoeoabgfenejglbffodgkkbkcdhcgfn`(Claude 확장 ID) 외부 확장 레지스트리 키가 있으나 값(path)이 없음 → 프롬프트 6에서 external extensions 메커니즘 검토 시 참고.

## 프롬프트 3 — 런처 + 브랜딩 ✅ (확장 방식으로 재해석, 2026-10-26)
- 한 일:
  - `browser.config.json`: 이름(작업명 **Fjord**, 한 곳에서 변경), 시작 페이지, 전용 프로필 이름, 번들 확장 목록.
  - `scripts/launch.ps1`: 스냅샷 확인 후 `--load-extension`(+`DisableLoadExtensionCommandLineSwitch`)으로 번들 확장을 로드해 실행. `scripts/launch.vbs`는 콘솔 창 없이 실행.
  - `scripts/make-shortcut.ps1`: 바탕화면에 `<이름>.lnk` 생성(아이콘 `assets/icon.ico`). `scripts/make-icons.py`: 아이콘 생성.
  - `docs/upgrade.md`: 스냅샷 교체/호환성 점검/보안 업데이트 절차 + 소스 빌드 전환 시 패치 리베이스 절차. `patches/`는 빈 상태(소스 수정 없음).
- 남은 일: 이름 확정(현재 Fjord는 임시), 창 제목/정보 페이지 등 Chromium 내부 문자열은 소스 수정 없이는 변경 불가.
- 알려진 문제: `--load-extension`이 이 스냅샷(158.0.8124.0)에서 동작하는지 사용자 실행 검증 전.

## 프롬프트 4 — 사이드바 ✅ (사용자 확인: 정상 작동, 2026-10-26)
- 방식 선택: 소스 패치 대신 MV3 확장 `extensions/sidebar` (`sidePanel` API). 아이콘 줄(접기/펼치기) + 사이트를 iframe으로 표시, `declarativeNetRequest`로 확장이 시작한 sub_frame의 `X-Frame-Options`/`Content-Security-Policy` 헤더 제거.
- 기능: 사이트 고정(아이콘+이름), 클릭 시 사이드 패널에 열기, 접기/펼치기(상태 저장), 설정 페이지에서 추가/삭제/순서 변경/기본값 복원, 패널 상단 새로고침/새 탭에서 열기.
- 알려진 문제: 상시 왼쪽 아이콘 줄은 불가(패널 안에 배치). 로그인 쿠키 정책(SameSite)/프레임 차단 우회로도 안 되는 사이트는 패널에서 정상 동작 안 할 수 있음 → ↗ 버튼으로 새 탭. 아직 실제 브라우저에서 실행 확인 안 됨.

## 스피드 다이얼 새 탭 ✅ (사용자 확인: 시작 탭/Ctrl+T 정상, 2026-10-26)
- 요청: 시작 탭이 about:blank → Opera 스피드 다이얼 같은 화면.
- 구현: `extensions/newtab` (MV3, `chrome_url_overrides.newtab`). 사이트 타일 그리드(파비콘/글자 아바타), 검색창(주소처럼 보이면 바로 이동, 아니면 기본 검색엔진 `chrome.search`), 시계, 타일 추가/편집/삭제/드래그 순서 변경. 데이터는 `chrome.storage.local`.
- `browser.config.json`: `startUrl`을 `chrome://newtab/`로, 확장 목록에 `extensions/newtab` 추가.
- 알려진 문제: 타일은 스크린샷 썸네일이 아니라 파비콘 기반(Opera의 페이지 썸네일은 확장으로 불가/비용 큼). 사이드바 항목과 목록은 별도 저장.
- 문제 발견: 첫 실행에서 Google 기본 새 탭이 떴음(스크린샷). Preferences에는 `chrome_url_overrides.newtab`이 정상 등록(active)돼 있어, 시작 시 확장이 로드되기 전에 첫 탭이 `chrome://newtab`으로 열린 경쟁 상태로 추정. 조치: `extensions/newtab/manifest.json`에 `key`를 넣어 확장 ID를 고정(`nnklkcbakchplbggofbfjijbmfepehnh`)하고 `startUrl`을 확장 페이지 URL로 직접 지정. Ctrl+T 새 탭의 오버라이드는 별도 확인 필요.

## 프롬프트 5 — 워크스페이스 + 광고 차단 🔶 (구현 완료, 사용자 확인 대기)
- 계획: `docs/plan-workspaces-adblock.md`. 각 기능은 브랜치(`workspaces`, `adblock`)에서 만들어 main에 병합.
- **워크스페이스** (`extensions/workspaces`): 탭 그룹(이름·색 동일) = 워크스페이스, 활성 것만 펼치고 나머지는 접음. 새 탭은 활성 워크스페이스로 자동 편입. 툴바 팝업에서 전환/추가/이름 변경/삭제, `Alt+Q`로 다음 워크스페이스. 기본 `개인`/`업무`.
- **광고 차단** (`extensions/adblock`): DNR 정적 규칙 세트 3개(EasyList 46,767 / EasyPrivacy 56,324 / List-KR 1,331 = 약 10.4만 개, 약 11MB). `scripts/update-filters.mjs`가 내려받아 `scripts/lib/abp-to-dnr.mjs`로 변환 → `extensions/adblock/rules/`(생성물, 커밋 안 함). 런처가 규칙이 없으면 자동 생성, `launch.ps1 -UpdateFilters`로 갱신. 팝업: 현재 사이트별 끄기(`allowAllRequests`), 전체/리스트별 토글, 배지로 차단 수 표시.
- 변환 범위: 네트워크 필터(`||`, `|`, `^`, `*`, `$third-party/$domain/리소스 타입/$important`, `@@`)만. 정규식, 요소 숨김(`##`), 스크립틀릿, `$csp/$redirect/$removeparam` 등은 제외 → YouTube 영상 광고 같은 건 못 막음.
- 한계/위험: 확장당 정적 규칙 30,000개까지만 보장, 초과분은 전역 풀(330,000)에서 남는 만큼 사용. Chrome이 일부 리스트를 켜지 못하면 팝업에 경고 표시. 규칙 JSON이 Chrome 검증에서 거부되는지는 브라우저 로드 전엔 확인 불가(제가 아는 제약 조건은 스크립트로 검사, 위반 0).

## 광고 차단: 직접 만든 확장으로 교체 (2026-10-27)
- 사용자의 기존 확장 `VScode/extension/adblock`(Universal Ad Skipper & Blocker 2.0.0, github.com/Jangwoo0827/adblock)이 DNR + 요소 숨김 + 스크립틀릿 + YouTube 광고 건너뛰기까지 포함해 더 완성도가 높아서 이걸 번들하기로 함.
- `browser.config.json`의 확장 경로를 `../extension/adblock`(저장소 밖 형제 폴더)로 지정. 내가 만든 `extensions/adblock`, `scripts/update-filters.mjs`, 변환기는 삭제(브랜치 `adblock` 히스토리에 남아 있음).
- 알려진 문제: 저장소 밖 경로를 참조하므로 이 PC 외에서는 해당 폴더가 필요(배포 단계에서 서브모듈 또는 복사로 정리).

## 확장 하나로 통합 ✅ (2026-10-27, 사용자 확인: 첫 탭, 사이드바, 워크스페이스, 광고 차단 정상)
- 사용자 요청: 확장이 늘어나면 20개가 될 테니 하나로 합칠 것.
- 결과: `extensions/fjord` 단일 MV3 확장(이름 Fjord, ID 고정 `nnklkcbakchplbggofbfjijbmfepehnh` — 이전 새 탭 확장과 같은 키라 스피드 다이얼 타일 유지). `modules/` 아래 sidebar / newtab / workspaces / adblock. service worker는 `background.js`(ES module) 하나가 각 모듈을 import.
- 툴바 아이콘은 하나(클릭 → 사이드 패널). 워크스페이스와 광고 차단 UI는 사이드 패널의 왼쪽 아이콘 줄 아래쪽(🗂 워크스페이스, 🛡 광고 차단)에서 패널 안에 열림. 항목 설정은 ⚙.
- 충돌 방지: 워크스페이스 메시지는 `ws:` 접두사만 처리, 사이드바의 프레임 헤더 제거 규칙은 세션 규칙(id 900001)으로 이동(광고 차단이 동적 규칙 id를 관리하므로).
- 시작 탭 문제(ERR_BLOCKED_BY_CLIENT, 사용자 스크린샷): 첫 탭이 확장 로드 전에 열려서 생긴 경쟁 상태. 이제 `startUrl`은 `about:blank`이고 새 탭 모듈이 브라우저 세션당 한 번 시작 탭을 스피드 다이얼로 교체/새로고침.
- 도구: `scripts/sync-adblock.mjs`(광고 차단 복사+경로 패치), `scripts/check-extension.mjs`(매니페스트/HTML 참조 파일 존재, JS 문법 점검 — 통과).
- 알려진 문제: 이전 개별 확장에서 저장한 사이드바 항목/워크스페이스 설정은 새 확장 ID라 초기화됨. 실제 Chromium에서 로드 확인 전.

## 프롬프트 6 — Claude 기본 통합 🔶 (구현 완료, 일부는 사용자 실행 필요)
**1. 설치 안내 방식 조사**
- 확장을 재배포하지 않는 후보: (a) 첫 실행 안내 페이지 + 웹스토어 링크 ← **채택**. (b) Chromium external extensions(레지스트리 `HKCU\Software\Google\Chrome\Extensions\<id>`): 시작 로그에 Claude ID 키가 보였지만 값(path)이 비어 있어 쓸 수 없고, 레지스트리 수정이 필요해 비채택. (c) 정책 `ExtensionInstallForcelist`: 정책 수정이 필요해 비채택.
- 구현: `extensions/fjord/modules/claude` — 세션당 한 번, Claude 확장(`fcoeoabgfenejglbffodgkkbkcdhcgfn`)이 없으면 안내 탭(`welcome.html`)을 연다. `웹스토어에서 설치` 링크, 설치되면 자동 감지(`management` 권한), `나중에`/`다시 묻지 않기`.

**2. 기본 고정**
- 사이드바: 기본 항목 첫 번째가 Claude(claude.ai).
- 툴바: 런처(`scripts/launch.ps1`)가 브라우저가 꺼져 있을 때 프로필 `Preferences`의 `extensions.pinned_extensions`에 Fjord와 Claude를 추가(`scripts/pin-extensions.mjs`). 임시 프로필로 단위 확인. 프로필이 아직 없으면 건너뜀. 다음 실행부터 적용.

**3. Claude Code `/chrome` 연동 (Native Messaging)**
- 확인한 것: Claude Code 문서 — 첫 `claude --chrome`/`/chrome` 때 호스트 설정을 설치하고, Windows는 브라우저별 레지스트리 키 `HKCU\Software\<브라우저>\NativeMessagingHosts\com.anthropic.claude_code_browser_extension`(기본값 = 매니페스트 JSON 경로). 다른 Chromium 브라우저는 자기 키를 쓰므로 이 스냅샷은 `HKCU\Software\Chromium\NativeMessagingHosts`.
- 이 PC 현황: Chrome 키에는 Claude Desktop 호스트(`com.anthropic.claude_browser_extension`, 허용 출처에 Claude 확장 ID 포함)만 있고, Claude Code 호스트(`..._claude_code_browser_extension`)는 아직 없음(`~/.claude/chrome` 없음: `claude --chrome`를 아직 안 돌린 상태). Chromium 키는 비어 있음.
- 스크립트: `scripts/install-native-hosts.cmd`(→ `.ps1`) — Chrome/Edge 키의 `com.anthropic.*` 등록을 Chromium 키로 미러링(`-DryRun`, `-Uninstall` 지원). Claude 앱(MSIX) 안에서는 레지스트리/파일 보기가 가상화돼 있어 **직접 더블클릭으로 실행**해야 함. 아직 실행하지 않음.

**4. 동작 확인**
- 정적 점검(`check-extension.mjs`, 스크립트 파싱, pin 스크립트 단위 테스트): 통과.
- 사용자 확인 필요: 안내 페이지 동작, 툴바에 Claude 아이콘 고정, `/chrome` 연결.
  1. 터미널에서 `claude --chrome`를 한 번 실행(Claude Code가 Chrome용 호스트를 등록).
  2. `scripts\install-native-hosts.cmd` 더블클릭(미러링) 후 Fjord 재시작.
  3. Claude Code에서 `/chrome` → Fjord가 연결되는지 확인하고 `docs/claude-extension-test.md` 14·15번에 기록.
- 알려진 문제: Claude Desktop 호스트와 Claude Code 호스트가 같은 확장 ID를 허용해서 충돌하는 사례가 보고됨(anthropics/claude-code 이슈 20411). 연결이 안 되면 어느 호스트가 응답하는지 확인 필요.

## Claude Code `/chrome` 연동 검증 (2026-10-27) — 부분 확인
- 확인됨: `install-native-hosts.cmd` 실행 후 `HKCU\Software\Chromium\NativeMessagingHosts`에 `com.anthropic.claude_browser_extension`(Claude Desktop)과 `com.anthropic.claude_code_browser_extension`(Claude Code) 둘 다 등록. Claude Code 매니페스트(`%APPDATA%\Claude Code\ChromeNativeHost\...json`)는 존재, `allowed_origins`에 Claude 확장 ID(`fcoeoabgfenejglbffodgkkbkcdhcgfn`) 포함, 호스트는 `~/.claude/chrome/chrome-native-host.bat` → `claude.exe --chrome-native-host`.
- 확인 안 됨: 실제 연결. Fjord(`profile-app`)와 테스트 프로필(`profile`) 어디에도 Claude 확장이 설치돼 있지 않음(Secure Preferences 확인). `list_connected_browsers`에는 일반 Chrome 하나만 보임(Fjord보다 먼저 연결됨).
- 다음: Fjord에서 Claude 확장 설치 + 로그인(안내 페이지 또는 웹스토어) → `list_connected_browsers`에 브라우저가 2개로 보이는지 확인 → `/chrome`에서 Fjord 선택.
