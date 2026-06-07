# OPERATIONS — auto-lecture 운영자 가이드

> 서울아산병원(amcacademy.skillflo.io) 의무교육 영상 자동수강 도구의 **운영/실행 안내**.
> 코드 내부 동작·함정은 `CLAUDE.md`, 변경이력은 `DEVLOG.md` 참조. 본 문서는 "어떻게 돌리고, 무엇을 확인하는가".

## 1. 무엇을 하는 도구인가
- skillflo 의무교육 강의를 **브라우저 자동조작(Playwright, headed)으로 영상 자동수강**.
- 두 종류 플레이어 지원: ① modulearning 외부플레이어형(예 27918), ② **skillflo 자체 `/classroom/` 플레이어형**(예 27962·32052).
- **영상 2배속** 재생, 차시 자동전환, 세션 만료 시 자동 재로그인, Discord 진행알림.
- 영상 수강만 자동(설문·최종평가는 과정에 따라 별도 — CLAUDE.md §4·5).

## 2. 사전 준비
- Node.js (테스트 환경 v22) + `npm install` (Playwright/chromium 설치됨).
- **`.env.json`** (git 제외, 직접 작성):
  ```json
  {
    "baseUrl": "https://amcacademy.skillflo.io",
    "userId": "<사번>",
    "password": "<비밀번호>",
    "geminiApiKey": "<Gemini API 키>",
    "discordToken": "<봇토큰>",
    "discordChannelId": "<채널ID>",
    "playbackRate": 2
  }
  ```
- 자격증명은 별도 보관(다른 프로젝트와 동일 토큰/키 재사용 가능). **절대 git에 올리지 말 것**(.gitignore에 `.env.json`·`state.json` 제외돼 있음).

## 3. 실행 방법
### (1) 수강할 과정 식별자 찾기
- 로그인 후 `/mypage/course`의 수강목록 API(`course-progress`)에서 courseId/productId 확인.
- 운영자가 직접 확인하려면: skillflo 로그인 → 내 강의 → 해당 과정 클릭 → URL의 `/course/<courseId>?productId=<productId>` 확인.
- 2026-06 기준 의무과정 3개는 모두 완료(§6 표). 새 과정이 열리면 동일 절차.

### (2) 수강 실행 (PowerShell)
```powershell
cd C:\Users\DW-RT\Github\auto-lecture
$env:COURSE_ID='<courseId>'; $env:PRODUCT_ID='<productId>'; $env:SPEED='2'
node watch.js
```
- 브라우저 창이 뜨고 자동 진행됨. **창을 닫거나 스크립트를 중단하지 말 것**(특히 시험 중).
- 진입에 ~1분 소요(정상). 이후 "재생 중 …" 로그가 흐름.

### (3) 진행 확인
- 콘솔 로그: `재생 중 N/M초 (%)`, `✅ 영상 완료`, `🎉 마지막 차시 도달`(=완료 신호).
- Discord 채널(`.env.json` 설정)에 하트비트/완료 알림.

## 4. 완료 판정 — 반드시 수강률로 검증
- watch.js가 `🎉 마지막 차시 도달 — 자동 진행 종료`를 출력하면 끝난 것.
- **실제 완료는 강의실 헤더 "수강률 100%" 로 확인**: 강의실 페이지 상단 `수강률: X% 수강시간 hh:mm:ss 강의시간 hh:mm:ss`. **수강시간 == 강의시간이면 100%**.
- 이 계열 과정은 **진도율 100%면 수료**(시험·과제 0점이어도 무관).

## 5. 자주 겪는 문제
| 증상 | 원인·해결 |
|---|---|
| "기존에 시청중인 강의가 있습니다… [아니오][예]" 팝업에서 멈춤 | classroom형 진입 팝업. **「예」 = 이어재생(정답, 초기화 아님)**, 아니오=이탈(영상 안켜짐), ESC=무효. watch.js가 자동 「예」 처리함. 수동 시에도 **「예」**. |
| 진입이 80초 넘게 안 됨 | 영상 스트리밍으로 `networkidle`이 안 끝나던 문제 — 최신 watch.js는 `domcontentloaded`로 해결됨. 더 길면 네트워크/세션 확인. |
| 로그인 타임아웃("계속하기" 못 찾음) | `/auth/signin` 폼이 `"사번을 입력해주세요"+"로그인하기"` 단일폼으로 변경됨. 최신 watch.js login()이 유연 처리. 옛 버전이면 갱신 필요. |
| 영상이 2배속이 아닌 듯 | 초대형 영상은 버퍼링으로 체감 느릴 수 있음(진도는 정상 누적). 2배속이 플랫폼 상한 — 그 이상 설정 금지. |
| 브라우저가 갑자기 닫힘 | 스크립트 중단(kill) 시 창이 닫힘. 진행 중엔 중단 금지. |
| 세션 만료로 페이지가 로그인 화면 | 정상(자주 발생). watch.js가 자동 재로그인. 진단 스크립트는 로그인 분기 포함해야. |

## 6. 과정 완료 현황 (2026-06-06)
| courseId / productId | 과정 | 형태 | 상태 |
|---|---|---|---|
| 27918 / 21159 | 보건업 안전보건교육 (12차시) | modulearning | ✅ 영상완주 + 시험제출 |
| 27962 / 21048 | 2026 기본의무과정 교수/의사직 (영상25개·7h55m) | classroom | ✅ 진도율 100% |
| 32052 / 22013 | 취약환자 학대·긴급복지 신고의무 법정교육 합본 (단일 4h40m) | classroom | ✅ 진도율 100% |

## 7. 보안·주의
- 자격증명(`.env.json`)·세션(`state.json`)은 **git 추적 금지**(.gitignore 적용됨).
- 자동수강은 **본인 계정의 의무교육 한정**. 타인 계정·시험 부정 등에 사용 금지.
- 일회성 진단 스크립트(`_*.js`)·스크린샷(`_*.png`)은 사용 후 삭제.
