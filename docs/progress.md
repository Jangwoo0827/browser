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

## 스피드 다이얼 새 탭 🔶 (사용자 요청, 구현 완료 · 확인 대기)
- 요청: 시작 탭이 about:blank → Opera 스피드 다이얼 같은 화면.
- 구현: `extensions/newtab` (MV3, `chrome_url_overrides.newtab`). 사이트 타일 그리드(파비콘/글자 아바타), 검색창(주소처럼 보이면 바로 이동, 아니면 기본 검색엔진 `chrome.search`), 시계, 타일 추가/편집/삭제/드래그 순서 변경. 데이터는 `chrome.storage.local`.
- `browser.config.json`: `startUrl`을 `chrome://newtab/`로, 확장 목록에 `extensions/newtab` 추가.
- 알려진 문제: 타일은 스크린샷 썸네일이 아니라 파비콘 기반(Opera의 페이지 썸네일은 확장으로 불가/비용 큼). 사이드바 항목과 목록은 별도 저장.
- 문제 발견: 첫 실행에서 Google 기본 새 탭이 떴음(스크린샷). Preferences에는 `chrome_url_overrides.newtab`이 정상 등록(active)돼 있어, 시작 시 확장이 로드되기 전에 첫 탭이 `chrome://newtab`으로 열린 경쟁 상태로 추정. 조치: `extensions/newtab/manifest.json`에 `key`를 넣어 확장 ID를 고정(`nnklkcbakchplbggofbfjijbmfepehnh`)하고 `startUrl`을 확장 페이지 URL로 직접 지정. Ctrl+T 새 탭의 오버라이드는 별도 확인 필요.
