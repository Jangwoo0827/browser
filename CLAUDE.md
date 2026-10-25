# CLAUDE.md — Chromium 기반 데스크톱 브라우저

프로젝트: Chromium 기반 데스크톱 브라우저 (Opera 스타일 기능 + Claude 확장 기본 지원)

## 원칙

1. Chromium 소스는 직접 수정을 최소화하고, 모든 변경은 별도 git 브랜치의 작은 패치로 관리한다 (나중에 새 Chromium 버전으로 리베이스하기 쉽게).
2. 가능하면 Chromium 코드를 고치기보다 번들 컴포넌트 확장이나 WebUI 페이지로 기능을 만든다.
3. 빌드는 오래 걸리므로 항상 백그라운드로 실행하고 로그를 파일로 남긴다 (`logs/`).
4. 큰 작업 전에는 계획을 먼저 보여주고, 디스크를 크게 쓰거나 되돌리기 어려운 명령은 실행 전에 나에게 확인한다.
5. 매 단계가 끝나면 `docs/progress.md`에 한 일 / 남은 일 / 알려진 문제를 기록한다.

## 작업 규칙 (이 머신)

- 이 폴더(`browser/`)는 자체 git 저장소이며 원격은 `github.com/Jangwoo0827/browser`. 상위 `VScode` 저장소에는 추적시키지 않는다.
- 단계가 끝날 때마다 commit + push (묻지 않음). `gh` CLI 없음 → 저장소 생성/릴리스는 GitHub API + `git credential fill` 토큰 사용 (토큰 출력 금지).
- Chromium 소스 체크아웃(`src/`, `depot_tools/`)은 이 저장소에 **커밋하지 않는다**. 저장소에는 `patches/`, `scripts/`, `docs/`, `extensions/`(번들 확장 소스)만 둔다. 체크아웃 위치는 디스크 여유가 있는 곳(아래 docs/progress.md 참고).
- 세션이 끊기면 `CLAUDE.md`와 `docs/progress.md`를 먼저 읽고 이어간다.
- PowerShell 5.1에서 한글 파일은 `Get/Set-Content`로 다루지 말고 Edit/Write 사용. `.ps1`은 ASCII로 유지.

## 폴더 구조

```
CLAUDE.md
docs/        progress.md, claude-extension-test.md, (upgrade.md 등)
scripts/     실행/설치/패치 내보내기 스크립트
patches/     git format-patch 결과물 (브랜치별)
extensions/  번들 컴포넌트 확장 소스
logs/        빌드/페치 로그 (gitignore)
```
