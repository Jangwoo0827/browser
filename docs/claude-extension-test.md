# Claude 확장 동작 검증 (빌드 전)

Chromium을 빌드하기 전에, 공식 미리 빌드된 Chromium에서 Claude 확장이 동작하는지 먼저 확인한다.

## 환경 조사 결과

- OS: Windows 11 Home x64 (RAM 15.7GB, 12스레드)
- 미리 빌드 바이너리: 공식 Chromium snapshot 버킷
  - 최신 리비전 조회: `https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/LAST_CHANGE` (조사 시점 r1726626)
  - 파일: `.../Win_x64/<rev>/chrome-win.zip` (약 370MB)
  - 참고: 스냅샷은 비브랜드 Chromium이라 Widevine/코덱/구글 로그인 동기화 등은 Chrome과 다름
- 현재 Chrome stable: 156.0.8078.x (versionhistory API 기준). 스냅샷은 그보다 앞선 개발 버전일 수 있음.
- Claude in Chrome 확장 ID(보고된 값, 설치 화면에서 확인할 것): `fcoeoabgfenejglbffodgkkbkcdhcgfn`
- Claude Code 연동은 Native Messaging 호스트(`com.anthropic.claude_code_browser_extension`)를 브라우저별 경로에 등록하는 방식. Windows 경로는 프롬프트 6에서 설치된 파일로 직접 확인한다.

## 실행

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-test-chromium.ps1
```

- 처음 실행 시 스냅샷을 `%USERPROFILE%\BrowserProject\chromium-snapshot`에 받고, 별도 프로필(`profile/`)로 실행한다. 평소 Chrome 프로필은 건드리지 않는다.
- 옵션: `-Update`(최신으로 재다운로드), `-Revision <n>`(고정), `-ResetProfile`(프로필 초기화)

## 체크리스트

각 항목을 직접 확인하고 아래 결과 표에 기록한다.

### A. 웹스토어
- [x] 1. `chromewebstore.google.com` 접속이 된다
- [x] 2. "Claude" 확장 페이지가 보이고 `Chrome에 추가` 버튼이 활성화된다
- [x] 3. 설치가 끝나고 `chrome://extensions`에 확장이 보인다 (ID 기록)
- [x] 4. 오류/경고(`이 확장은 지원되지 않는 브라우저`, 매니페스트 오류 등)가 없다

### B. 로그인
- [x] 5. 확장 아이콘/팝업에서 Claude 로그인 페이지가 열린다
- [x] 6. 로그인 완료 후 확장이 로그인 상태로 돌아온다 (Google 로그인 포함 시도)

### C. 사이드 패널
- [x] 7. 확장 아이콘 클릭 시 사이드 패널이 열린다 (`chrome.sidePanel`)
- [x] 8. 페이지를 이동해도 패널이 유지/동작한다
- [x] 9. 대화 입력 → 응답이 정상 표시된다

### D. 브라우저 제어
- [x] 10. 현재 탭 내용 읽기 ("이 페이지 요약해줘")
- [x] 11. 클릭/입력 같은 페이지 조작 ("검색창에 X 입력하고 검색")
- [x] 12. 새 탭 열기/탭 전환
- [x] 13. 스크린샷 기반 동작 (`chrome.debugger`/`tabs.captureVisibleTab`)

### E. Claude Code 연동 (선택, 프롬프트 6 준비용)
- [ ] 14. Claude Code에서 `/chrome` 실행 시 이 브라우저가 연결되는가 (아마 Native Messaging 등록이 필요 → 안 되면 정상)
- [ ] 15. `chrome://extensions` → Claude 확장 → `서비스 워커` 콘솔에 `connectNative`/`Native host not found` 류 에러가 있는지 기록

### 실패 시 기록할 것
- `chrome://extensions` → 확장 `오류` 버튼 / 서비스 워커 콘솔 로그
- 막힌 API 이름 (`sidePanel`, `nativeMessaging`, `debugger`, `identity` 등)
- 사용자 에이전트/브라우저 식별 검사로 거부되는지 (`chrome://version`의 UA)

## 결과 표

| # | 항목 | 결과 (O/X/부분) | 메모·오류 메시지 |
|---|------|-----------------|------------------|
| 1 | 웹스토어 접속 | O | 사용자 확인 (전부 정상) |
| 2 | 확장 페이지/추가 버튼 | O | 사용자 확인 (전부 정상) |
| 3 | 설치 완료 (ID) | O | 사용자 확인 (전부 정상) |
| 4 | 설치 경고 없음 | O | 사용자 확인 (전부 정상) |
| 5 | 로그인 페이지 열림 | O | 사용자 확인 (전부 정상) |
| 6 | 로그인 완료 | O | 사용자 확인 (전부 정상) |
| 7 | 사이드 패널 열림 | O | 사용자 확인 (전부 정상) |
| 8 | 페이지 이동 후 유지 | O | 사용자 확인 (전부 정상) |
| 9 | 대화/응답 | O | 사용자 확인 (전부 정상) |
| 10 | 탭 읽기 | O | 사용자 확인 (전부 정상) |
| 11 | 클릭/입력 | O | 사용자 확인 (전부 정상) |
| 12 | 새 탭/전환 | O | 사용자 확인 (전부 정상) |
| 13 | 스크린샷 동작 | O | 사용자 확인 (전부 정상) |
| 14 | Claude Code /chrome 연결 | 미확인 | 프롬프트 6에서 확인 |
| 15 | 서비스 워커 에러 | 미확인 | |

테스트한 Chromium 리비전: r1726626 (158.0.8124.0) · 날짜: 2026-10-26

## 결과 해석 → 다음 단계

- 모두 O: 프롬프트 2(빌드)로 진행. 확장은 웹스토어 설치 안내 방식으로 통합.
- 사이드 패널/제어만 X: 막힌 API 확인 후 프롬프트 4~6 설계 조정 (필요하면 Chromium 쪽 패치 범위 결정).
- 웹스토어/로그인 X: 비브랜드 Chromium 제약(API 키, 브랜딩 검사) 여부 확인.
