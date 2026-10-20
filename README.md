# auto-lecture — 강의 자동 수강기

서울아산병원(amcacademy.skillflo.io) 의무교육 강의를 **자동 재생·진행**합니다.
두 플레이어 지원: ① modulearning 외부플레이어형, ② **skillflo 자체 `/classroom/` 플레이어형**.

> 📌 **운영자 실행 안내는 [OPERATIONS.md](OPERATIONS.md), 내부 구조·함정 종합 가이드는 [CLAUDE.md](CLAUDE.md), 이력은 [DEVLOG.md](DEVLOG.md), 프로젝트 회고(STAR)는 [dev-journal.md](dev-journal.md).**
> - **경희의료원 사이버연수원(khmc.migaedu.com)** 도 지원: `khmc/run.js`(다계정 병렬 수강, 과정 자동수집) + `khmc/verify.js`(수료완료 검증·스크린샷). OPERATIONS.md §8.
> - classroom형 "기존 시청중" 팝업은 **「예」**(이어재생·초기화 아님). CLAUDE.md §11~14.
> - 최종평가(1회한정·커스텀 라디오 재렌더·교차검증)는 CLAUDE.md §5.

## 영상 배속
- 기본 **2배속**(`SPEED=2` 또는 `.env.json` `playbackRate`). 플랫폼 상한이 2배속이라 그 이상 금지.

## 자동 처리 항목
- **창 표시(headed)** — 기본적으로 브라우저 창을 띄운 채 실행 (`HEADLESS=1` 이면 창 없이, 권장 안 함)
- **「다음 차시로 이동하시겠습니까?」** 등 팝업 → 모달 우선 + 긍정 버튼 우선순위로 `예`/`확인`/`이동`/`다음 차시` 자동 클릭
- **중간 확인 버튼** — 학습확인, 확인, 다음 등
- **퀴즈/평가** — 실제 입력요소가 있고 영상이 없을 때만 동작(오탐 방지), 문항별 첫 보기 선택 후 제출, 같은 퀴즈 중복 제출 방지
- **세션 자동 복구** — 장시간 실행 중 로그아웃/만료 감지 시 재로그인 후 플레이어 재진입
- **진도 패턴** — 15초마다 마우스/클릭·가시성 이벤트, **2배속** 재생 유지(`SPEED`)
- **classroom형 "기존 시청중" 팝업** — 자동 「예」 처리(이어재생, 초기화 아님). CLAUDE.md §11
- **디스코드 알림** — 레벨별(시작·진행·완료·경고·오류) 색상 임베드, 주기적 하트비트 카드

## 준비
1. `npm install` (최초 1회, playwright 포함)
2. `.env.json` — `userId`, `password`, 선택 `discordWebhook`(웹훅 URL)

## 실행
```powershell
cd C:\Users\DW-RT\Github\auto-lecture
node watch.js
```

### 환경 변수
| 변수 | 설명 |
|------|------|
| `COURSE_ID` / `PRODUCT_ID` | 수강 과정 ID (필수) |
| `SPEED` | 영상 배속 (기본 2, 상한 2) |
| `HEADLESS=1` | 창 없이 실행 (기본은 창 표시, 권장 안 함) |
| `POLL_MS` | 재생 상태 체크 주기 (기본 5000) |
| `UI_SCAN_MS` | 팝업/퀴즈 스캔 주기 (기본 2500) |
| `HEARTBEAT_MS` | 디스코드 하트비트 주기 (기본 300000) |

예: `$env:COURSE_ID='27962'; $env:PRODUCT_ID='21048'; $env:SPEED='2'; node watch.js`

## 동작
- 로그인 후 `state.json` 저장 → 다음 실행부터 세션 재사용
- 콘솔에 진행률 로그, 디스코드 웹훅 설정 시 알림
- 종료: Ctrl+C 또는 브라우저 종료

## 참고
- 퀴즈는 **첫 보기 자동 선택**입니다. 오답 시 직접 수정이 필요할 수 있습니다.
- 탐색 스크립트(`explore*.js`)는 구조 파악용, 실사용은 `watch.js`만 사용하면 됩니다.
