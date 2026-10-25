# 접근 방식 변경: 소스 빌드 → 미리 빌드된 Chromium + 번들 확장 + 런처 (2026-10-26)

## 결정
이 PC는 C: 여유가 약 93GB, RAM 15.7GB라 Chromium 소스 빌드(소스 40~60GB + 출력 25~40GB, 풀 빌드 8~16시간)가 현실적이지 않다.
그래서 **공식 snapshot Chromium을 그대로 쓰고, 기능은 번들 확장(MV3) + 작은 런처로 구현**한다. (CLAUDE.md 원칙 2에 부합)

| 항목 | 소스 빌드 | 채택한 방식 |
|------|-----------|-------------|
| 디스크 | 100GB+ | 약 1~1.5GB (스냅샷 압축 해제 ~1GB, 확장/런처 수 MB) |
| 빌드 시간 | 수 시간 | 없음 (스냅샷 다운로드만) |
| Chromium 업데이트 | 리베이스 + 재빌드 | 새 스냅샷/stable 빌드로 교체 |

## 기능 구현 방식
| 기능 | 구현 | 한계 |
|------|------|------|
| 사이드바 (프롬프트 4) | `sidePanel` API + 아이콘 목록 페이지, 사이트 열기는 iframe(+ `declarativeNetRequest`로 X-Frame-Options/CSP frame-ancestors 제거) | Opera처럼 창 왼쪽 별도 상시 아이콘 줄은 불가 → 사이드 패널 안에 아이콘 배치 |
| 워크스페이스 (프롬프트 5-1) | `tabGroups` + 창 분리/숨김 전환 | 탭 스트립 UI 자체 변경 불가 |
| 광고 차단 (프롬프트 5-2) | `declarativeNetRequest` 정적 규칙(필터 리스트 → 변환 스크립트) | 규칙 수 제한(정적 규칙 전역 한도/확장당 보장 한도) → 핵심 규칙만 선별, 갱신은 확장 업데이트로 |
| Claude 통합 (프롬프트 6) | 웹스토어 설치 안내 페이지 + 사이드바 기본 항목, Native Messaging 매니페스트는 설치 스크립트로 등록 | 확장 재배포 안 함 |
| 브랜딩 (프롬프트 3) | 런처 exe, 바로가기 이름/아이콘, 시작 페이지 | 브라우저 내부 문자열(창 제목, about 페이지)은 Chromium 그대로 |
| 배포 (프롬프트 7) | 작은 설치 파일(런처 + 번들 확장) + 첫 실행 시 스냅샷 다운로드, GitHub Releases | 코드 서명 없으면 SmartScreen 경고 |

## 런처 설계 (초안)
- `scripts/` PowerShell → 이후 작은 단일 exe(Go/Node SEA 등)로 교체 검토
- 동작: 스냅샷 확인/다운로드 → `--user-data-dir`(전용 프로필) + `--load-extension=<bundled>` (+ 필요 시 `--disable-features=DisableLoadExtensionCommandLineSwitch`) 로 실행
- 주의: 최신 Chromium은 `--load-extension`을 제한하는 기능 플래그가 있을 수 있어 스냅샷 버전에서 실제로 되는지 검증 필요 (되지 않으면 정책(`ExtensionInstallForcelist`/로컬 CRX) 또는 프로필 사전 구성으로 대체)

## 정말 소스가 필요해지면
- 상시 왼쪽 아이콘 줄, 탭 스트립 변경 등 확장으로 불가능한 항목만 모아서 외장 SSD(256GB+) 또는 클라우드 빌드 머신에서 진행. 이 경우 `fetch --no-history`, 컴포넌트 빌드, `symbol_level=0` 권장. 세부 요구사항은 당시 공식 문서(windows_build_instructions.md)로 재확인.
