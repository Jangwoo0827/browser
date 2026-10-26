# Chromium 버전 올리기 / 패치 관리

현재 방식(스냅샷 Chromium + 번들 확장)에서는 Chromium 소스를 고치지 않으므로 "리베이스"는 **바이너리 교체 + 확장 호환성 점검**으로 대체된다.
(소스 빌드로 전환하게 되면 아래 "소스 빌드 전환 시" 절을 따른다.)

## 업데이트 절차

1. 새 스냅샷 확인/교체
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\launch.ps1 -Update
   ```
   - `-Update`가 `LAST_CHANGE`의 최신 리비전을 받아 `%USERPROFILE%\BrowserProject\chromium-snapshot\bin`을 교체하고 `revision.txt`를 갱신한다. 프로필은 그대로 유지된다.
   - 특정 리비전 고정: `scripts\run-test-chromium.ps1 -Revision <n> -NoLaunch`
2. 확장 점검 (`chrome://extensions`에서 오류 확인)
   - `manifest.json`의 사용 API(`sidePanel`, `declarativeNetRequest`, `tabGroups` 등) 변경/폐기 공지는 Chrome Platform Status, Chrome for Developers 변경 로그에서 확인.
   - `--load-extension`이 막히면: 런처는 `--disable-features=DisableLoadExtensionCommandLineSwitch`를 이미 붙인다. 그래도 안 되면 정책(`ExtensionInstallForcelist`) 또는 로컬 CRX/프로필 사전 구성으로 전환.
3. 회귀 확인
   - `docs/claude-extension-test.md` 체크리스트 재실행 (웹스토어, 로그인, 사이드 패널, 브라우저 제어).
   - 사이드바 확장: 항목 열기, 접기/펼치기, 설정에서 추가/삭제.
4. `docs/progress.md`에 새 리비전/버전과 결과 기록 → commit + push.

## 보안 업데이트 주기

- 스냅샷은 개발 빌드(canary 성격)라 stable보다 앞서지만 **보안 패치 보장이 없다.** 최소 격주로 `-Update` 실행, stable 채널에 보안 릴리스가 올라오면 즉시 갱신.
- stable 버전 확인: `https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?filter=endtime=none&order_by=version%20desc`
- 배포 단계(프롬프트 7)에서 "stable 버전에 대응하는 리비전을 고정 다운로드" 방식으로 바꿀지 검토한다.

## 패치 폴더 (`patches/`)

현재는 비어 있다. 소스 빌드로 전환하면 브랜치별 변경을 `git format-patch`로 내보내 이곳에 둔다:

```bash
git -C <chromium>/src format-patch <base-tag>..<branch> -o patches/<branch>
```

## 소스 빌드 전환 시 (참고)

1. 새 stable 태그 fetch: `git fetch --depth=1 origin tag <새 태그>`
2. 기능 브랜치를 새 태그 위로 리베이스: `git rebase --onto <새 태그> <이전 태그> <브랜치>`
3. 충돌 해결 → `gclient sync -D` → 증분 빌드 → 체크리스트 재실행 → 패치 재내보내기
4. 디스크 요구사항은 `docs/build-plan.md`의 "정말 소스가 필요해지면" 참고.
