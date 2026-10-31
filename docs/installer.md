# 설치 파일 (Fjord-Setup.exe)

## 만들기
```
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```
결과: `dist\Fjord-Setup.exe` (약 0.5MB). Windows 기본 도구 IExpress로 만든 자동 압축 해제 설치 파일이라 별도 프로그램이 필요 없다. **PowerShell 도구/터미널에서 실행**(bash에서 `powershell.exe`로 부르면 IExpress가 실패하는 경우가 있었다).

## 안에 들어 있는 것
- `payload.zip`: 런처 스크립트(`scripts/`), 번들 확장(`extensions/fjord`, `extensions/theme`), 아이콘, `browser.config.json`, `uninstall.ps1`
- `installer/install.ps1`: 설치 과정(UTF-8 BOM, 한글 메시지)
- Chromium 스냅샷은 **들어 있지 않다**: 설치 중 대상 PC에서 받는다(약 400MB, 이어받기 지원).

## 설치가 하는 일
1. `%LOCALAPPDATA%\Programs\Fjord`에 파일 복사(기존 설치는 교체; 브라우저 데이터는 건드리지 않음)
2. 설정 > 앱 목록에 등록(제거 가능)
3. 바탕화면·시작 메뉴 바로가기
4. Chromium 받기 → `%USERPROFILE%\BrowserProject\chromium-snapshot` (프로필·북마크 등 사용자 데이터도 여기)
5. (선택) 바로 실행

## 알아둘 점
- **코드 서명이 없어서** 처음 실행할 때 SmartScreen 경고("PC를 보호했습니다")가 뜬다. "추가 정보 > 실행".
- 작업 표시줄 아이콘/이름 꾸미기(브랜딩)와 도구 모음 고정은 **Node.js가 있을 때만** 적용된다(없으면 설치 중 안내만 하고 건너뜀).
- 개발 PC에 설치하면 데스크톱의 기존 `Fjord` 바로가기가 설치본을 가리키도록 덮어쓰인다. 제거하면 그 바로가기도 지워진다.
- 제거: 설정 > 앱 > Fjord. 방문 기록·북마크·로그인과 Chromium도 지울지 물어본다(자동/무인 실행은 `-DeleteData`를 줘야만 지움).
- 무인 설치/테스트: `Fjord-Setup.exe /Q`는 `-Silent -NoLaunch`로 실행(기본 위치, 바로가기·다운로드 포함). 파일만 풀어 보려면 `install.cmd -Dir <폴더> -Silent -NoDownload -NoShortcuts -NoLaunch`.
