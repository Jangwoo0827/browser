# 프롬프트 2 계획 — 빌드 환경 + 소스 받기 (승인 대기)

> 아래 요구사항은 Chromium 공식 Windows 빌드 문서 기준으로 정리한 것이며, 실행 직전에 최신 문서(`chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md`)로 한 번 더 대조한다.

## 이 PC 현황 (2026-10-26 확인)

| 항목 | 현재 | Chromium 요구/권장 | 판정 |
|------|------|--------------------|------|
| OS | Windows 11 x64 | Win10/11 64bit | OK |
| 디스크(C:) 여유 | **약 93GB** (드라이브 C: 하나뿐) | 소스+히스토리 최소 약 100GB + 빌드 출력 수십 GB | **부족 위험** |
| RAM | 15.7GB | 최소 16GB, 권장 32GB+ | **빠듯** (링크 단계 OOM 위험) |
| CPU | i5-12450H, 12스레드 | 코어 많을수록 좋음 | 가능하나 느림 |
| Visual Studio | 2022 BuildTools 17.14 | VS 2022 + C++ 데스크톱 개발, MFC/ATL | 구성요소 재확인 필요 |
| Windows SDK | 10.0.26100.0 | 최신 SDK + **Debugging Tools for Windows** | 디버깅 도구 **없음** → 추가 설치 필요 |
| Python / Git | 3.11.9 / 2.54 | depot_tools 번들 사용 | OK |
| 긴 경로 | 확인 필요 | 짧은 경로(`C:\cr`)에 체크아웃 | 짧은 경로 사용 |

## 부족한 것 / 설치 (설치 전 확인 요청)
1. depot_tools: git clone (작음, ~수백 MB) → `C:\src\depot_tools`
2. VS Build Tools 구성요소 추가(Installer 수정): "MSVC v143 x64/x86 빌드 도구", "C++ ATL", "C++ MFC", Windows 11 SDK 10.0.26100 → 수 GB
3. Windows SDK "Debugging Tools for Windows" 추가(Windows Settings > 앱 > 설치된 앱 > Windows Software Development Kit > 수정)
4. 환경 변수: `DEPOT_TOOLS_WIN_TOOLCHAIN=0`, PATH에 depot_tools 추가, Defender에서 소스/출력 폴더 제외(성능, 사용자 승인 필요)

## 소스 받기 계획
- 대상: 최신 **stable** 태그. 현재 stable 채널: **156.0.8078.49** (157은 0.5% 롤아웃 중이라 제외). 태그 `156.0.8078.49` 체크아웃.
- 방법(디스크 최소화):
  ```
  mkdir C:\cr && cd C:\cr
  fetch --nohooks --no-history chromium     # 히스토리 없이 (약 30~40GB 다운로드 → 압축 해제 후 약 40~60GB)
  cd src && git fetch --depth=1 origin tag 156.0.8078.49 && git checkout 156.0.8078.49
  gclient sync -D --with_branch_heads --no-history -j8
  ```
  - `--no-history`는 패치 리베이스에 필요한 태그 간 diff를 위해 **필요한 태그만 `--depth=1`로 추가 fetch**하는 방식으로 보완. 풀 히스토리는 디스크상 불가능.
- 예상 용량: 소스 약 40~60GB(no-history) / 풀 히스토리 100GB+(불가).
- 예상 시간: 다운로드 회선에 따라 1~3시간 + hooks 수십 분. 백그라운드 + `logs/fetch.log`.

## gn 빌드 설정 (out/Default) — 시간/용량 절감 위주
```
is_debug = false
is_component_build = true
symbol_level = 0
blink_symbol_level = 0
enable_nacl = false
is_official_build = false
use_jumbo_build = false
proprietary_codecs = false
dcheck_always_on = false
target_cpu = "x64"
```
- 컴포넌트 빌드 + symbol_level 0이 핵심. 디버그(`is_debug=true`)는 수십 GB 더 커져서 이 PC에선 비권장.
- 예상: 첫 풀 빌드 약 8~16시간(i5-12450H·16GB), 출력 약 25~40GB. 링크 병렬 수는 `-j8` 이하로 제한(OOM 방지). 이후 증분 빌드는 분 단위.

## ⚠️ 결정이 필요한 위험
디스크 93GB로는 **소스(40~60GB) + 출력(25~40GB)** 이 한계선입니다. 옵션:
1. **다른 드라이브 사용** (외장 SSD 256GB+ 권장) — 가장 안전
2. C: 정리 후 진행(앱 데이터/캐시 정리 최소 30GB 확보) — 빠듯, 중간 실패 시 재시도 비용 큼
3. **빌드 없이 확장 기반으로 구현** — 사이드바/광고 차단/워크스페이스/Claude 통합을 번들 확장 + 별도 런처로 구현 (Chromium 소스 불필요, 원칙 2에 부합). 프롬프트 1 결과가 좋으면 가장 현실적.
4. 클라우드 빌드 머신(Windows VM, 32코어/64GB)에서 빌드 — 비용 발생

권장: 프롬프트 1 결과를 먼저 확인 → 확장 기반으로 가능한 범위를 정하고, 꼭 필요한 부분만 (옵션 1 또는 4로) 소스 빌드.
