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
