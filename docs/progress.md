# Progress

## 프롬프트 0 — 프로젝트 규칙 ✅ (2026-10-26)
- 한 일: `CLAUDE.md` 작성, 폴더 구조(docs/scripts/patches/extensions/logs) 정리, 자체 git 저장소 + GitHub 원격 생성.
- 남은 일: 없음.

## 프롬프트 1 — 빌드 없이 Claude 확장 검증 🔶 (스크립트/문서 완료, 사용자 확인 대기)
- 한 일:
  - OS/하드웨어 확인: Windows 11 x64, RAM 15.7GB, 12스레드, C: 여유 ~93GB, VS 2022 BuildTools 설치됨.
  - 공식 snapshot 버킷에서 Win_x64 `chrome-win.zip`(약 370MB, r1726626) 확인.
  - `scripts/run-test-chromium.ps1`: 스냅샷 다운로드 + 별도 프로필 실행.
  - `docs/claude-extension-test.md`: 체크리스트 + 결과 표.
- 스냅샷 다운로드/실행은 사용자 승인 후 진행(logs/snapshot-download.log). 남은 일: 웹스토어에서 Claude 확장 설치 → 체크리스트/결과 표 기록 → 결과 공유.
- 알려진 문제: 사용자 확인 전.

## 방향 전환 (2026-10-26)
- 디스크(~93GB)/RAM(15.7GB) 한계로 소스 빌드 대신 **스냅샷 Chromium + 번들 확장 + 런처** 방식 채택. 상세: `docs/build-plan.md`.
- 프롬프트 2(소스 fetch/빌드)는 보류. 프롬프트 3~7은 확장/런처 기준으로 재해석.
- 알려진 문제: 상시 왼쪽 아이콘 줄/탭 스트립 변경은 확장으로 불가. `--load-extension`이 이 스냅샷에서 동작하는지 검증 필요.

## 스냅샷 실행 메모 (2026-10-26)
- 스냅샷 r1726626(Chromium 158.0.8124.0, 압축 해제 ~830MB)을 `%USERPROFILE%\BrowserProject\chromium-snapshot`에 설치. 다운로드는 중간에 끊겨 `curl.exe -C -`(이어받기)로 교체.
- `%LOCALAPPDATA%`에 두면 Claude 데스크톱 앱(MSIX)에서 경로가 가상화됨 → 경로를 `%USERPROFILE%`로 변경.
- Claude 앱 안(샌드박스된 도구)에서 띄우면 `Sandbox cannot access executable ... chrome.exe (0x5)`, 네트워크 서비스 크래시가 발생 → **직접 `scripts/run-test-chromium.cmd` 더블클릭으로 실행**해서 검증할 것.
- 관찰: 시작 로그에 `HKCU\Software\Google\Chrome\Extensionscoeoabgfenejglbffodgkkbkcdhcgfn`(Claude 확장 ID) 외부 확장 레지스트리 키가 있으나 값(path)이 없음 → 프롬프트 6에서 external extensions 메커니즘 검토 시 참고.
