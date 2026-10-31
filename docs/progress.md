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

## Claude Code `/chrome` 연동 검증 결과 (2026-10-27) ✅ 연결 확인, 일부 불안정
- 연결됨: Fjord에 Claude 확장 설치·로그인 후 `list_connected_browsers`에 브라우저 2개(일반 Chrome + Fjord)로 보임. Fjord를 재시작해도 같은 deviceId로 자동 재연결. Fjord를 선택해 탭 그룹 생성, `https://example.com` 이동, 페이지 JS 실행까지 성공(UA `Chrome/158.0.0.0` = 스냅샷, 일반 Chrome 156과 구분).
- 불안정: 브라우저를 막 켠 직후 `tabs_context_mcp(createIfEmpty)`가 `No group with id: …`로 여러 번 실패했다가 이후엔 성공. 추적(CDP로 Fjord 서비스 워커의 탭/그룹 이벤트 기록) 결과 Claude가 만든 그룹(제목 "Claude" → 세션 제목)이 만든 직후 지워지고 탭이 워크스페이스 그룹(`개인`)으로 옮겨진 경우가 있었음. 워크스페이스 모듈을 끈 상태에서도 한 번 실패해서 단독 원인은 아님. 조치: 워크스페이스가 새 탭/새 창/이동된 탭을 가져가는 시점을 1.5초 늦춰 다른 확장이 먼저 그룹을 만들도록 함(원인 확정은 못 함).
- 도구: `launch.ps1 -DebugPort <port>`(loopback 전용 `--remote-debugging-port`), `launch.vbs`가 인자를 전달. 확장 서비스 워커 로그/이벤트 추적에 사용.
- 발견: Fjord 프로필(`profile-app`)에 예전에 불러온 `ddmmkmpddiopjojigiakicbcghlmhndo`(사용자의 Universal Ad Skipper를 unpacked로 직접 로드한 것으로 추정)가 남아 있어 광고 차단이 둘 다 활성. 통합 확장의 광고 차단 모듈만 쓰려면 `chrome://extensions`에서 그 항목을 제거할 것. 통합 광고 차단의 `Duplicate script ID 'scriptlets'` 경고는 `applyEnabled`가 두 번 동시에 도는 데서 오는 무해한 경고(원본 확장 코드 동작).

## 작업표시줄 브랜딩 (2026-10-27) ✅ — "Chromium" → "Fjord"
- 문제: 작업표시줄에 Chromium 아이콘/이름으로 표시.
- 해결(소스 수정 없이, 스냅샷 파일 후처리):
  - `scripts/brand-exe.mjs` + `scripts/set-exe-icon.ps1`: `chrome.exe`를 `fjord.exe`로 복사하고(원본 유지) 버전 정보(FileDescription/ProductName 등)를 rcedit로, 메인 아이콘 그룹 `IDR_MAINFRAME`은 Win32 `UpdateResource`로 교체(rcedit `--set-icon`은 문자열 이름 아이콘 그룹을 못 바꿈). 스냅샷이 바뀌면 자동 재생성. rcedit은 `%USERPROFILE%\BrowserProject\tools`에 설치(저장소 밖).
  - `scripts/brand-paks.mjs`: 로케일 팩(`locales/*.pak`, v5 UTF-8)의 "Chromium" 문자열을 이름으로 교체(창 제목 접미사 등, 57개 팩/38,768 문자열). 원본은 `.orig`로 보관. 자체 테스트: 항목 ID/개수 유지 확인.
  - `scripts/taskbar-identity.ps1`(+ `scripts/lib/shell-props.ps1`): 숨김 감시 프로세스가 Fjord 창마다 AppUserModelID(`Fjord.Browser`, 설정 `appId`), 재실행 명령(`wscript launch.vbs`), 아이콘, 표시 이름을 지정. 바탕화면 바로가기에도 같은 ID를 찍음(`make-shortcut.ps1`). → 실행 중인 창을 우클릭 "작업 표시줄에 고정"하면 올바른 런처/아이콘/이름으로 고정되고, 바로가기를 고정해도 같은 버튼으로 묶임.
- 확인: UI Automation으로 작업표시줄 버튼이 `Fjord - 1개의 실행 중인 창`, `Appid: Fjord.Browser`로 표시, 창 제목 `새 탭 - Fjord`, 프로세스 `fjord.exe`. `exe` 아이콘은 추출해서 새 아이콘 확인.
- 한계: 현재 아이콘은 내가 만든 임시 아이콘(UI 디자인 단계에서 교체 예정). 창에 미리 쓰인 값을 다시 읽을 수는 없음(셸 제약) → 감시 프로세스가 창 핸들마다 한 번 기록. 브라우저가 켜져 있는 동안은 exe/팩을 다시 쓸 수 없어 런처가 건너뜀(콜드 스타트에만 적용).
- 런처 개선: `logs/launch.log`에 실행 기록(숨김 실행 실패가 안 보이던 문제), 실행 중 판정을 프로세스 이름 `chrome.exe`/`fjord.exe` 모두로.

## UI 디자인 시스템 (2026-10-29) 🔶 — 코드 완료, Figma 일부, 실제 브라우저 확인 대기
- 벤치마크 조사(Opera/Arc/Vivaldi/Edge/Brave/Zen; 자료가 얇아 방향 참고용) → `docs/design/README.md`에 채택/회피 정리. 핵심: 왼쪽 레일 + 사이드 패널, 한 화면에 한 개념, 모션 ≤120ms(감소 모션 존중), **스피드 다이얼이 워크스페이스를 따라감**.
- Figma(`fWkyK4QNyMaEM4K65JwHf2`): 토큰(원시 28 + 의미 색 18×라이트/다크 + space/radius/size), 텍스트 스타일 8개, 컴포넌트 6종(RailButton·SpeedDialTile·WorkspaceRow·ToggleRow·Button·SearchField), 화면 2개(사이드 패널 접힘/펼침). **Figma MCP 호출 한도(Starter)에 걸려** 워크스페이스/광고 차단/새 탭/다크 화면은 Figma에 못 만들고 코드로 구현. Starter는 컬렉션당 모드 1개라 라이트/다크를 별도 컬렉션으로 분리.
- 코드: `extensions/fjord/ui/{tokens.css,base.css,icons.js}` 공용 토큰/베이스/아이콘, 사이드 패널(레일 48/168px, SVG 아이콘, 활성 상태), 워크스페이스 페이지, 새 탭(시계 + 워크스페이스 칩 + 칩별 스피드 다이얼 + 검색), 옵션, Claude 설치 페이지를 토큰 기반으로 재작성. 광고 차단 팝업은 동기화 스크립트가 토큰으로 테마 덮어쓰기(영문 문구는 원본 그대로).
- 도구: `scripts/preview-server.mjs`(chrome.* 스텁을 주입해 일반 브라우저에서 확장 페이지 미리보기). 내장 브라우저로 새 탭(라이트), 워크스페이스 페이지(라이트), 광고 차단+펼친 레일(다크) 스크린샷 확인.
- 남은 일: Fjord에서 실제 확인, Figma 나머지 화면(한도 해제 후), 앱 아이콘 교체, 광고 차단 팝업 한글화.

## 화면 가장자리 레일 (2026-10-29) ✅ 동작 확인 — 항상 보이는 왼쪽(또는 오른쪽) 아이콘 줄
- 요청: 사이드 패널을 열지 않아도 항상 보이는 왼쪽 사이드바.
- 구현: `extensions/fjord/modules/rail` — 콘텐츠 스크립트가 http(s) 페이지(최상위 프레임)에 닫힌 shadow root로 48px 레일을 그리고(페이지 CSS와 격리) 페이지를 그만큼 밀어냄. 아이콘: 고정 사이트 + 워크스페이스·광고 차단·설정. 클릭하면 `rail:open` 메시지 → 백그라운드가 사이드 패널을 열고(`sidePanel.open`, 사용자 제스처 안에서 먼저 호출) 해당 항목을 선택. 새 탭(확장 페이지)에는 같은 레일을 직접 마운트. 옵션 페이지에서 켜기/끄기와 위치(왼쪽/오른쪽) 설정(`railSettings`).
- 검증(CDP로 Fjord에 직접): example.com에서 레일 렌더링(라이트/다크 스크린샷), 실제 마우스 입력으로 Google 아이콘 클릭 → 사이드 패널 페이지가 열림(`railLast.ok=true`, `ui.activeId=google`). 새 탭 페이지에서도 레일 렌더링 확인.
- 고친 것: 토큰 CSS가 shadow root에서 적용되도록 `:host`를 추가(레일 배경이 투명했음), 알려진 사이트의 글자 아바타 색(Claude 주황 등) `ui/glyph.js`.
- 한계: `chrome://` 페이지, PDF 뷰어, 확장 페이지(새 탭 제외)에는 안 보임. 페이지 가장자리를 밀어내는 방식이라 `position: fixed` 요소가 레일에 일부 겹칠 수 있음. 일부 사이트는 CSP 때문에 파비콘 대신 글자 아바타로 표시됨.
- 도구: `launch.ps1 -DebugPort`로 켠 Fjord에 CDP로 접속해 스크린샷/클릭/서비스 워커 평가(스크래치 스크립트, 저장소엔 미포함).

## 위쪽 UI + 오페라식 워크스페이스 (2026-10-29)
- 요청: 탭 줄은 위쪽 그대로, 크롬 디자인과 탭 그룹이 불편 → 오페라처럼(사이드바의 아이콘 워크스페이스).
- 조사: 이 Chromium 빌드에는 **세로 탭이 내장**(`vertical_tabs.enabled` 프리퍼런스; UIA로 켜짐 확인)이지만 사용자는 위쪽 탭 줄을 원해서 **꺼 둠**(`browser.config.json`의 `browserPrefs`, 런처가 `scripts/apply-prefs.mjs`로 적용). 확장으로는 탭 줄/툴바 자체를 바꿀 수 없음(소스 수정 필요).
- **워크스페이스 v2 (탭 그룹 제거)**: 워크스페이스마다 **브라우저 창이 하나**라서 위쪽 탭 줄에는 그 워크스페이스 탭만 보임. 전환 = 대상 창 활성화(같은 크기/상태) + 이전 창 최소화. 탭 URL 스냅샷으로 재시작 후 복원, Alt+Q, 현재 탭 이동, 아이콘 변경(클릭으로 순환), 삭제 시 탭은 첫 워크스페이스로 이동. 레일 맨 위에 워크스페이스 아이콘(활성은 강조), 새 탭 칩에도 아이콘.
- 검증(CDP): `ws:switch`로 대상 창 생성/최대화, 이전 창 최소화(왕복 3회 일관), 실제 마우스로 레일의 서류가방 아이콘 클릭 → `wsActive=work`. 탭 줄이 가로로 돌아온 것과 탭 그룹 표시가 사라진 것은 UI Automation으로 확인.
- **테마**: `extensions/theme`(어두운 Fjord 색: 프레임/툴바/탭/주소창). 이 빌드에서 `--load-extension`으로 로드되어 `management`에 `type: theme, enabled`로 확인. 실제 색은 눈으로 확인 못 함(브라우저 UI는 스크린샷 불가).
- **중요한 발견(서비스 워커 캐시)**: Chromium은 프로필에 저장된 서비스 워커 등록을 재사용해서 **ES 모듈로 import한 파일(`modules/*/background.js`)을 고쳐도 재시작 후 옛 코드가 계속 실행**됨(등록된 스크립트 URL이 옛 `background.js`로 남아 있음을 `chrome://serviceworker-internals`에서 확인). 해결: `scripts/stamp-build.mjs`가 전체 파일 해시를 넣은 `sw.js`(생성물, git 제외)를 서비스 워커 진입점으로 만들고, 런처가 해시가 바뀌면 프로필의 `Service Worker` 캐시를 지움. **이전에 한 워크스페이스 지연(1.5초)/탭 그룹 관련 수정은 실제로는 적용되지 않은 채 테스트됐을 가능성이 큼**(Claude 탭 그룹 오류 원인은 미확정이지만 탭 그룹을 없애서 해당 경로 자체가 사라짐).
- 한계: 창이 여러 개라 작업표시줄에 Fjord 창이 워크스페이스 수만큼 보임(최소화됨). 탭 URL 복원은 http(s)만. 워크스페이스 창-매핑은 세션 안에서만 유지(재시작 후 URL 스냅샷으로 복원).
- 도구: 스크래치 CDP 스크립트(스크린샷/클릭/서비스 워커 평가)는 저장소 밖.

## Electron 앱 `app/` (2026-10-29) 🔶 1단계 완료 — 병행 프로젝트
- 요청: 위쪽 탭 UI를 자유롭게 만들 수 있게 "엔진만 Chromium, UI는 직접" (Electron 방식). 기존 Chromium+확장 버전은 그대로 두고 `app/`에 새로 시작. 설계/제약/로드맵: `docs/electron-app.md`.
- 구현: 프레임 없는 창 + 우리 크롬 UI(왼쪽 레일: 워크스페이스 아이콘·고정 사이트·도구, 탭 줄, 툴바/주소창) + 탭마다 `WebContentsView`. 워크스페이스는 탭 목록(창/그룹 없음), 탭 드래그 정렬, 탭/워크스페이스 우클릭 메뉴, 단축키, 상태 저장·복원, `fjord://` 프로토콜로 공용 디자인 토큰 재사용, 새 탭 페이지(시계·검색·고정 사이트), 크롬 UA.
- 검증: `npm run smoke` 11개 전부 통과(탭 열기/제목, 워크스페이스 전환·개수·유지, 탭 이동/닫기, 워크스페이스 추가, 디스크 저장) + 보이지 않는 창으로 UI/콘텐츠 스크린샷 확인(`logs/app-ui.png`: 레일/탭/툴바 렌더링). 실제 창에서 마우스 조작(드래그, 우클릭 메뉴, 창 이동/버튼)은 아직 직접 확인 못 함.
- 잃는 것: Chrome 확장(Claude 확장, Claude Code /chrome 연동, 우리 광고 차단 확장), Google 계정 동기화, DRM 영상, 자동 보안 업데이트. 대체는 앱 안에 직접 구현(광고 차단 webRequest, Claude 사이드 패널 등).
- 다음: 다운로드/찾기/줌/컨텍스트 메뉴/설정/방문기록 → 광고 차단·Claude 패널 → 패키징·자동 업데이트.

## Electron 앱 2단계: 브라우저 기본 기능 (2026-10-29) ✅ 스모크 23/23
- 추가: 페이지 위에 그리는 **오버레이 뷰**(주소 자동완성, 찾기 막대, 다운로드 패널), 주소창 자동완성(고정 사이트 + 방문 기록, 방향키/Enter), 방문 기록 페이지(`Ctrl+H`), 페이지 내 찾기(`Ctrl+F`), 확대/축소(`Ctrl+=/-/0`, 툴바 배지), 다운로드(자동 저장, `Ctrl+J` 패널, 열기/폴더/취소, 완료 알림), 페이지 우클릭 메뉴(링크·이미지·선택·입력창·소스 보기·검사).
- 스모크 테스트를 로컬 HTTP 서버 기반으로 확장(기록, 자동완성, 찾기 3건, 줌 120%, 4KB 다운로드, 팝업, 방문 기록 페이지) + 팝업 스크린샷(`logs/app-suggest.png`, `app-downloads.png`)으로 렌더링 확인.
- 발견: Electron의 `findInPage`는 페이지가 포커스를 가질 때만 결과를 주고, 오버레이 입력창이 포커스를 가지면 첫 요청이 버려짐 → 요청 전에 페이지에 포커스, 결과 이벤트에서 찾기 입력창으로 포커스 복귀, 답이 없으면 한 번 재요청. 테스트 창은 활성화하지 않아서(사용자 화면 방해 금지) 그 영향으로 테스트가 최대 3번 묻습니다. 실제 활성 창에서의 찾기 사용감은 직접 확인 못 함.
- 남은 일: 권한 요청 UI, 북마크, 설정 페이지(검색엔진, 다크/라이트), 닫은 탭 복원, 광고 차단, Claude 사이드 패널, 패키징.

## 버그 수정: 워크스페이스 추가 시 사이드/탑바 멈춤 (2026-10-29)
- 원인: 추가/이름 변경 입력창을 UI 뷰 안의 모달 `<dialog>`로 열었는데, UI 뷰는 웹페이지 뷰 *아래*에 있어서 창이 보이지 않은 채 모달이 레일과 탭 줄을 전부 비활성화함.
- 수정: 입력창을 페이지 위에 그리는 오버레이(`prompt`)로 이동(`promptShow`/`promptSubmit`), UI의 dialog 코드 삭제. 중복 이름이면 메시지를 보여 주고 열린 채로 유지, 바깥을 누르거나 Esc면 닫힘.
- 스모크 테스트 27/27(프롬프트 열림, 중복 오류, 추가, 이름 변경 추가) + 프롬프트 스크린샷 확인. 실제 마우스로 눌러 본 것은 아님.
- 같은 종류의 함정 주의: **UI 뷰 안의 팝업/모달/드롭다운은 페이지 뷰에 가려진다** → 모든 팝업은 오버레이로. (`docs/electron-app.md`)

## 기능 체크리스트·로드맵 작성 (2026-10-29)
- `docs/feature-checklist.md`: 사용자가 정리한 22개 영역을 항목별로 현재 상태(✅/🔶/⬜/⛔)와 마일스톤(M1~M6)에 매핑. P2는 구현 가능한 것 위주로 절반 이상 목표, 서버·라이선스가 필요한 항목(번역·동기화 서버·DRM·VPN·안전 브라우징)은 대안과 함께 명시.

## 버그 수정: 탭 닫기 버튼 클릭이 안 먹힘 (2026-10-29)
- 원인: 탭의 `mousedown`이 "탭 활성화" → 상태 갱신 → 탭 줄 전체 재렌더를 일으켜서, 닫기 버튼이 `mouseup` 전에 다른 요소로 교체되어 `click`이 발생하지 않음.
- 재현: 스모크 테스트에 **실제 마우스 입력**(`sendInputEvent`)으로 닫기 버튼을 누르는 항목을 먼저 추가해 실패(5→5)를 확인한 뒤 수정.
- 수정: 닫기 버튼은 `mousedown`에서 바로 닫고(탭 활성화는 닫기 버튼 위에서 무시), 클릭 전파 차단. 스모크 29/29(연속 4회 통과). 페이지 로드 확인은 고정 대기 대신 제목이 뜰 때까지 기다리도록 바꿔 간헐 실패 제거, 다운로드 대기 12초.

## M1a: 탭 기능 (2026-10-29) ✅ 스모크 40/40
- 닫은 탭 복원(`Ctrl+Shift+T`, 최근 25개 저장), 탭 고정/해제(앞쪽 고정, 아이콘만 표시), 탭 복제(원본 바로 뒤), 탭 음소거(재생 중/음소거 아이콘, 클릭으로 전환), 왼쪽/오른쪽/다른 탭 닫기(고정 탭 보호), 탭 우클릭 메뉴 확장, 탭 검색(`Ctrl+Shift+A` 또는 탭 줄의 돋보기; 모든 워크스페이스의 탭을 제목/주소/워크스페이스로 필터, 방향키+Enter).
- 새 탭이 고정 탭 앞으로 끼어들지 않도록 삽입 위치 규칙 정리.

## M1b: 북마크 (2026-10-30) ✅ 스모크 51/51
- 북마크 저장소(북마크 바/기타/폴더, 폴더 삭제 시 북마크는 기타로 이동), 주소창 별 버튼 + `Ctrl+D`(이미 있으면 편집) → 오버레이 편집 팝업(이름·폴더·삭제), 북마크 바(`Ctrl+Shift+B` 토글, 클릭=열기, Ctrl/Shift/가운데 클릭=새 탭, 우클릭 메뉴, 폴더 칩=메뉴), 북마크 관리 페이지(`Ctrl+Shift+O`: 검색·폴더 이동·삭제·폴더 추가), Netscape HTML 내보내기/가져오기(Chrome/Firefox 호환), 주소창 자동완성에 북마크 포함.
- 페이지 뷰 위치는 `topH()`로 동적(바가 보이면 +34px). 테스트: 추가/이름 변경/폴더/제안/실제 마우스로 칩 클릭/내보내기→가져오기 왕복/폴더 삭제/바 토글 시 페이지 좌표 변화.
- **발견·수정**: `.gitignore`의 `src/` 규칙이 `app/src/`(main.js, store.js, preload.js)까지 무시해서 지금까지 Electron 앱의 핵심 소스가 커밋되지 않았음 → `/src/`(루트 Chromium 체크아웃만)로 수정하고 이번 커밋에 포함.
- 남은 일(M1): M1c 설정/인쇄/전체 화면/창 상태, M1d 권한·인증서 오류·보안 표시.

## M1c: 설정·인쇄·전체 화면·창 상태·오류 페이지 (2026-10-30) ✅ 스모크 70/70
- 설정 페이지(`Ctrl+,` 또는 레일의 설정 버튼): 시작 방식(이전 탭 복원/새 탭/홈페이지), 홈페이지 주소·툴바 홈 버튼, 검색엔진(Google/네이버/DuckDuckGo/Bing/직접 입력 `%s`), 테마(시스템/라이트/다크, 타이틀바 색 포함), 북마크 바, 다운로드 폴더, 단축키 안내. 값 검증은 `Store.setSetting`.
- 인쇄: `Ctrl+P`(시스템 인쇄 창), 우클릭 메뉴의 "인쇄…"/"PDF로 저장"(다운로드 목록에 등록). 전체 화면: `F11` 및 페이지 요소 전체 화면(동영상) — 크롬 UI를 숨기고 페이지가 창 전체를 사용.
- 창 위치/크기/최대화 기억(`windowstate.fitBounds`: 모니터가 사라졌거나 너무 작으면 보정). 비정상 종료 감지(`running` 플래그): 비정상 종료 뒤에는 시작 방식과 관계없이 탭 복원.
- 오류 페이지(`error.html`): 연결 실패(`did-fail-load`)와 렌더러 충돌(`render-process-gone`)을 한국어 안내 + "다시 시도"로 표시, 주소창에는 원래 주소 유지.
- 확인 못 한 것: 실제 시스템 인쇄 창, 실제 전체 화면 전환(테스트 창은 숨겨져 있어 플래그/레이아웃만 검증), 최대화 복원, 라이트 테마의 실제 모습.

## M1d: 권한·사이트 정보·팝업 차단·인증서 오류 (2026-10-30) ✅ 스모크 83/83 → M1 완료
- 권한 프롬프트(위치/알림/카메라·마이크/클립보드/MIDI/화면 공유 등): 주소창 아래 오버레이 카드에서 차단 / 이번만 허용 / 허용. 허용·차단은 사이트별로 저장(`permissions`), 전체화면·클립보드 쓰기 같은 무해한 것은 자동 허용, 목록에 없는 권한은 거부, `fjord://`·`file://`은 권한 없음. 탭이 비활성이면 대기했다가 돌아오면 표시, 이동/닫기 시 자동 거절. Permissions API 조회도 같은 저장값을 따름.
- 주소창 보안 표시(자물쇠 / "안전하지 않음"(http) / "인증서 오류" / 로컬 파일) + 클릭하면 사이트 정보 패널(연결 상태, 위치·알림·카메라·클립보드·팝업을 묻기/허용/차단으로 변경). 설정 페이지에 사이트 권한 목록(변경/지우기/전체 초기화).
- 팝업 차단: 사용자 클릭/키 입력 직후(1.5초)가 아닌 `window.open`은 차단하고 주소창 오른쪽 아이콘으로 표시 → 열기 / "이 사이트 팝업 항상 허용".
- 인증서 오류: `-2xx` 로드 실패를 경고 페이지로 표시, "안전한 곳으로 돌아가기" 또는 "안전하지 않음으로 이동"(이번 실행 동안만 해당 출처 허용, 저장 안 함, 주소창에 빨간 "인증서 오류").
- 테스트: 정책/저장소 단위, 실제 geolocation·Notification 요청으로 프롬프트→허용/차단→사이트 응답, 스크립트 팝업 차단 vs 클릭 직후 허용, openssl로 만든 자체 서명 HTTPS 서버로 경고 페이지→진행(openssl이 없으면 SKIP). 스크린샷 `logs/app-permission.png`, `app-siteinfo.png`, `app-cert.png` 확인.
- 확인 못 한 것: 실제 사용자 클릭으로 허용했을 때의 포커스 동작, 팝업 판정이 실제 사이트(결제/로그인 팝업)에서 오탐/미탐 없는지, 외부 인증서 사이트. 스모크가 한 번 "탭 검색 열림" 이후 멈춘 적이 있음(재실행 시 통과, 남은 gpu 프로세스는 PID로 정리) — 원인 미확인 간헐 문제.
- **M1(필수 기본기) 완료.** 다음: M2(다중 창·탭 끌어내기, 시크릿/게스트/프로필, 데이터 삭제 UI, 광고·트래커 차단, 다운로드 일시정지/재개, 사이트별 줌 등).

## M2a-1: 데이터 삭제·쿠키·사이트별 줌 (2026-10-30) ✅ 스모크 93/93
- 설정 페이지에 "인터넷 사용 기록 삭제"(`Ctrl+Shift+Delete`: 기간 1시간/24시간/7일/4주/전체 × 방문 기록·다운로드 기록·쿠키·캐시·사이트 데이터·사이트 권한), "쿠키"(도메인별 개수·삭제·검색), "사이트별 확대/축소"(목록·지우기).
- 사이트별 줌을 저장해 재시작 후에도 유지, 같은 사이트의 다른 페이지도 같은 배율로 열림.
- 한계: Electron은 쿠키/캐시/사이트 데이터를 기간별로 지우는 API가 없어서 이 항목들은 기간과 상관없이 전체 삭제(화면에 명시). 방문/다운로드 기록은 기간별.

## M2a-2: 다운로드 일시정지/이어받기/다시 시도 (2026-10-30) ✅ 스모크 96/96
- 다운로드 패널에 일시정지/이어받기, 취소·중단된 항목의 "다시 시도"(같은 주소에서 새로 받고 옛 항목 교체). 테스트용 느린 다운로드 서버(90KB/3초)로 일시정지 중 바이트가 늘지 않음, 이어받기 후 완료, 취소→재시도 완료를 확인.
- 간헐 실패 1회 관찰: 오류 페이지 테스트가 한 번 실패("Current display surface not available" 포함), 재실행 시 통과. 숨김 창 캡처 타이밍 문제로 추정, 미해결.

## M2b: 광고·추적 차단 (2026-10-30) ✅ 스모크 103/103
- 호스트 기반 차단기(`app/src/blocker.js`): 확장과 공유하는 기본 규칙(baseline/trackers, 145개 도메인) + 선택적으로 HaGeZi Pro 목록(약 21만 도메인, 4.6MB, jsDelivr)을 받아 `||host^` 줄만 사용. 파싱 ~1.2초는 조각 단위로 나눠 UI가 멈추지 않게 함, 조회는 100k회 0.17초.
- `webRequest.onBeforeRequest`로 하위 리소스만 차단(메인 프레임·같은 사이트는 통과). 탭별 차단 수(레일 방패 버튼 배지)와 누적 수 표시, 방패 패널(켜기/끄기, 이 사이트에서 끄기→자동 새로고침, 목록 업데이트), 설정 페이지에 같은 기능과 "차단을 끈 사이트" 목록.
- 기본값: 켜짐 + 목록 자동 업데이트 켜짐(앱 시작 5초 뒤 7일이 지났으면 받음, 설정에서 끌 수 있음). 처음에는 기본 규칙만, 첫 업데이트 뒤 전체 목록.
- 한계: 도메인 단위 차단만(경로 패턴·정규식·요소 숨김(cosmetic)·YouTube 광고 스크립트릿 없음) → 같은 도메인에서 오는 광고(예: YouTube)는 못 막음. 확장의 EasyList 변환 로직을 앱으로 옮기는 건 후속 과제.

## M2c: 다중 창 · 시크릿/게스트 창 · 탭 이동 (2026-10-30) ✅ 스모크 118/118
- **구조 변경**: 창마다 `ctx`(BaseWindow, 크롬 뷰, 오버레이, 탭 뷰/메타, 탭 저장소). main.js의 모듈 변수는 항상 "현재 창"을 가리키고 `inCtx(ctx, fn)`이 바꿔 끼움 → 기존 단일 창 코드를 거의 그대로 유지. 이벤트/타이머/메뉴 클릭은 `inCtx`/`later`/`popupMenu`를 통해 올바른 창으로 돌아옴. 세션 훅(권한·차단·다운로드)은 파티션마다 `ensureSession`으로 설치.
- 새 창 `Ctrl+N`, 새 시크릿 창 `Ctrl+Shift+N`, 새 게스트 창(툴바 ⋯ 메뉴). 첫 창만 프로필 저장소(재시작 후 복원), 다른 창은 메모리 전용 탭 목록(워크스페이스 이름은 복사).
- 시크릿 = 메모리 전용 세션(`fjord-private`): 쿠키·캐시가 일반과 분리, 방문 기록·권한·줌 결정은 저장 안 함, 마지막 시크릿 창을 닫으면 세션 데이터 삭제. 게스트 = 시크릿 + 고정 사이트/북마크/기록/자동완성 숨김. 보라색 크롬 + "시크릿/게스트" 배지.
- 탭 이동: 탭 메뉴의 "새 창으로 이동" / "창 N으로 이동", 탭을 창 밖으로 끌면 새 창(다른 창 위에 놓으면 그 창으로). 페이지(webContents)는 그대로 유지되며 이동. 같은 세션끼리만(시크릿↔일반 이동 불가). 창의 마지막 탭은 이동 불가.
- 툴바 ⋯ 메뉴(새 창들, 북마크, 기록, 다운로드, 확대/축소, 찾기, 인쇄, 전체 화면, 기록 삭제, 설정, 종료).
- 한계: 두 번째 이후 일반 창의 탭은 재시작 후 복원 안 됨, 다중 프로필(영속 userData 분리)은 M3, 실제 드래그로 창 밖으로 끌기는 사람이 직접 확인 못 함(자동 테스트는 `moveTabToWindow`와 `tabDragEnd` 로직만), "스모크 한 번 `Current display surface not available`로 실패 후 재실행 통과"가 2회 발생(숨김 창 캡처 타이밍으로 추정).
- **M2 완료**(프로필 제외): 데이터 삭제·쿠키·사이트별 줌, 다운로드 제어, 광고·추적 차단, 다중/시크릿/게스트 창.

## Chromium 테마 갱신 (2026-10-31)
- `extensions/theme` 0.2.0: 인디고 액센트(툴바 아이콘 색), 프레임에 은은한 인디고 글로우 이미지(`frame.png`, 1600x96) 추가. 이전 0.1.0 테마는 사용자의 Fjord에서 이미 적용돼 있는 것을 화면으로 확인(프레임·툴바·주소창·사이드 패널이 어둡게 바뀜).
- 0.3.0: 프레임 이미지를 피오르드 야경(오로라+산 능선+별)으로 교체(코드로 렌더, Canva 생성 이미지는 198px 미리보기만 받을 수 있어 참고용으로만 사용). 실제 Fjord 창에서의 모습은 아직 못 봄 — 완전히 껐다 켜면 적용됨.
- 내 이미지를 쓰려면 `extensions/theme/frame.png`를 교체(가로로 반복, 높이 약 80~100px 권장)하고 `manifest.json`의 `version`을 올린 뒤 Fjord 재시작.
- 테마 0.4.0: 활성 탭 위쪽에 인디고→보라→청록 그라데이션 선(`toolbar.png`의 윗부분이 활성 탭/툴바 배경으로 쓰임) + 활성 탭 글자색 연한 인디고. 탭 *모양*은 테마로 못 바꿈(색/이미지만). 실제 모습은 재시작 후 사용자가 확인 필요.
- 새 탭 배경: 확장 새 탭 페이지(`modules/newtab`)와 Electron 새 탭에 피오르드 야경 배경(`extensions/fjord/ui/bg-fjord.jpg`, 1920x1080, 72KB, 다크 모드만). 원인: 테마의 `theme_ntp_background`는 Chrome 기본 새 탭에만 적용되고, 우리 확장이 새 탭을 대체하면 페이지가 자기 배경을 칠하기 때문에 테마가 안 보였음. 실제 모습은 재시작 후 사용자가 확인 필요.
- 테마 0.5.0: 활성 탭에 위→아래로 옅어지는 인디고→보라→청록 그라데이션 채움 + 윗선, 비활성 탭에도 옅은 그라데이션(`tab_background.png`). 탭의 *외곽선/모양*에는 그라데이션 불가(테마는 채움 이미지만 바꿈). 이미지 세로 위치(탭 윗면에 맞는지)는 재시작 후 사용자 확인 필요.

## Chromium 확장: 사이드 패널 v2 + 레일 v2 (2026-10-31)
- **사이드 패널**(`modules/sidebar`): 왼쪽 아이콘 줄을 없애고 **위쪽 패널 스위처**(활성 항목만 라벨 표시, 스크롤, 화살표 키 이동)로 교체. 패널: **Claude**(claude.ai + "페이지 요약/선택 설명/번역/새 대화" 칩 — `?q=` 프리필, 페이지 글자는 700자까지), **북마크**(폴더 트리 접기/펼침 기억, 검색, 현재 페이지 추가, 호버 액션, 삭제 되돌리기), **기록**(검색, 오늘/어제/날짜 그룹, 항목 삭제, 기록 삭제 창 열기), **열린 탭**(모든 창을 워크스페이스 이름으로 묶어 표시, 검색, 소리 표시, 닫기, 현재 창 배지). 고정 사이트·워크스페이스·광고 차단은 같은 스위처에서 계속 사용.
- **레일**(`modules/rail`): 48px 아이콘 줄이 마우스를 올리면 224px로 펼쳐지며(0.26초 지연, 페이지 위에 겹침) 라벨과 구역 제목(워크스페이스/패널/사이트) 표시. 활성 워크스페이스는 왼쪽 막대 + 강조, 패널 4개(Claude/북마크/기록/탭)를 레일에서 바로 열기, 워크스페이스 추가 버튼. 워크스페이스 관리 페이지도 새 스타일(아이콘 타일, 개수 알약, 활성 막대).
- 권한 추가: `bookmarks`, `history`, `favicon`(Chrome 파비콘 캐시 사용). 아이콘 5종 추가(sparkles/tabs/bookmark/more/chevronRight).
- **화면 확인**: `scripts/preview-panel.cjs`(Electron 숨김 창 + 모의 `chrome` API)로 다크/라이트 스크린샷을 `logs/panel-*.png`, `logs/rail-*.png`, `logs/workspaces-page-*.png`에 생성. 실제 Fjord 안에서 `chrome.*` 실제 동작(특히 북마크/기록/탭 API, `?q=` 프리필, 파비콘)은 재시작 후 사용자가 확인해야 함. 이 확인 방식은 실제 브라우저 UI(툴바/탭 줄)는 못 그림.
- 한계: 사이드 패널 위치(좌/우)는 Chrome 설정이 정함(확장이 못 바꿈). 리서치: 웹 검색 결과가 얇아 Edge/Arc/Vivaldi/Opera 사이드바 패턴은 기존 지식 + 출처 일부로 정리.

## 둥근 아이콘 · 새 탭 화면 개편 · 설치 파일 (2026-10-31)
- **아이콘**: 둥근 모양(원형 그라데이션 + 옅은 테두리/하이라이트, 안에 레일+페이지 기호). `scripts/make-icons.py`로 확장 아이콘/`assets/icon.*` 재생성. 작업 표시줄 exe 아이콘은 다음 콜드 스타트에 `brand-exe`가 다시 입힘.
- **새 탭**(`modules/newtab`): 시간대별 인사 + 큰 시계 + 날짜, 유리(glass) 검색창(`/`로 포커스), 워크스페이스 분할 스위치, 둥근 사각 타일 스피드 다이얼(Chrome 파비콘 캐시 사용), **열린 탭 줄**(탭 줄 모양의 알약, 클릭하면 이동, +로 스피드 다이얼에 추가), 최근 방문/북마크 카드("더 보기"는 사이드 패널의 해당 패널 열기). 다크에서는 피오르드 야경 배경. 화면은 `scripts/preview-panel.cjs`로 다크/라이트 확인. Electron 앱의 새 탭은 그대로(이번엔 Chromium 쪽만).
- **설치 파일**: `scripts/build-installer.ps1` → `dist/Fjord-Setup.exe`(IExpress). 설치/제거 스크립트는 `installer/`. 테스트: 파일 풀기·레지스트리 등록·제거 정보까지 임시 폴더에서 확인(바로가기/Chromium 다운로드/실제 실행/제거는 직접 해 보지 않음). 자세한 내용 `docs/installer.md`.
