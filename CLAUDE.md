# auto-lecture — skillflo/modulearning 강의 자동 수강·시험 가이드

> 임직원 의무교육(skillflo→modulearning) 자동화. 영상 자동수강 + 최종평가 자동풀이.
> **다음번엔 이 문서로 바로 처리할 것.** (2026-06-04 기준 전 과정 1회 완주·시험 제출 완료)

## 0. 핵심 식별자 (수강 과정들)
> ⚠️ **과정마다 플레이어가 다름**: ① modulearning(fast.modulearning.kr) 외부플레이어형, ② **skillflo 자체 `/classroom/` 플레이어형**. 진입·팝업·재생감지가 달라서 §11 별도 참조.

**A. modulearning형 — `[모두의 안전] 보건업 12차시`** (2026-06-04 영상완주+시험제출 완료)
| courseId / productId | `27918` / `21159` |
| contentsCode/lectureOpenSeq/studySeq | `WCD7NL` / `93030` / `5066390` |
| 수료기준 | 진도20점+최종평가 → 총점 70↑ |

**B. skillflo classroom형 — `2026 AMC 기본의무과정 교수/의사직`** (영상 25개·7h55m, 2026-06-05 2배속 100% 완주)
| courseId / productId | `27962` / `21048` |
| 플레이어 | skillflo `/classroom/{productId}/{courseId}/content/{contentId}` (영상=kollus iframe `v.kr.kollus.com`) |
| 수료기준 | **진도율 100%** (시험·과제 0점이어도 수료) |

**C. skillflo classroom형 — `취약환자 학대·긴급복지 신고의무자 법정교육 합본`** (2026-06-06 2배속 100% 완주)
| courseId / productId / content | `32052` / `22013` / `386248` |
| 구성 | **단일 영상 4h40m(16803초) 합본** — 차시분할 없음. 진행중 세션 없어 "기존 시청중" 팝업 미발생 |

→ **2026-06-06 현재 의무과정 3개(27918·27962·32052) 모두 100% 완료.**

**공통**: 로그인ID = `.env.json`의 `userId`(사번). ⚠️ **`/auth/signin` 폼 변경됨**: 이제 `"사번을 입력해주세요" + "로그인하기"` (옛 username→"계속하기"→password 2단계 아님). watch.js `login()`은 유연 처리(첫 input에 사번→계속하기/로그인하기/로그인/submit→비번칸 있으면 입력). 세션 만료 잦음. 내 수강목록 = `api.skillflo.io/api/b2e/mypage/course-progress`(앱이 호출하는 응답을 page.on('response')로 가로채야 함; CORS로 직접 fetch 불가). ongoingCourses[].id=courseId, .product.id=productId.

### 영상 배속 (2026-06-04 추가)
- `watch.js`에 `PLAYBACK_RATE`(기본 **2배속**). 환경변수 `SPEED=2`(또는 `.env.json` playbackRate). 플랫폼 제공 최대가 2배속이라 그 이상은 진도 미인정·되돌림 위험 → **2배속이 상한**.

## 1. 진입 흐름 (정확한 경로)
```
skillflo /course/27918?productId=21159&tab=info
  → "강의 보기" 클릭(popup) → modulearning studyCenterSsoV2/study.php (스터디센터)
    → "수강하기" → study/studyView.php (영상 플레이어, video는 frame 안)
    → "최종평가" 버튼 → study/userTestPage.php?like=final (주의사항→시험)
```
- 영상 세그먼트 경로: `mobile/03/04.mp4`, `mobile/08/08.mp4` 등. **폴더번호 ≠ 차시번호**(매핑 비선형). 플레이어가 알아서 미완료 차시부터 resume.

## 2. 상태/진도 API (권위 있는 원본)
- **엔드포인트**: `https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=WCD7NL&lectureOpenSeq=93030&studySeq=5066390`
- **반드시 플레이어 세션 컨텍스트에서 호출**(`player.request.get`). 그냥 로그인만으로 직접 호출하면 `{totalCount:0}`.
- 주요 필드: `totalProgress`(진도%), `passProgress`(이수기준=100), `survey`(Y/N), `testStatus`(Y/N 최종시험 응시), `testScore`, `passScore`(70), `certPass`, `certDate`, `totalPassTest`, `conversionTest`
- ⚠️ **`certPass="Y"`는 완료 판정에 쓰지 말 것** — 영상 미완·시험 미응시인데도 Y였음. **영상완료=`totalProgress>=passProgress`, 시험완료=`testStatus==='Y'`** 로 판단.

## 3. 영상 자동 수강 — `watch.js`
- **headed(창 표시)로 실행**. 1배속 고정, 15초마다 진도 상호작용 이벤트.
- **차시 전환 팝업** = SweetAlert2 `"다음 차시로 이동하시겠습니까?" [이동][닫기]`. **확인 문구가 보이는 모달 안의 "이동"만** 클릭.
  - ❌ 페이지 상시 "다음" 나비버튼을 누르면 → `"현재 영상 수강 후 넘어갈 수 있습니다"` 차단팝업 무한루프. (상시버튼 클릭 금지, 차단팝업은 닫기만)
- 🔴 **마지막(12)차시에서 "이동" 누르면 1차시(03/01)로 wrap-around → 전체 재수강 루프.** → **영상 완료마다 API로 진도 확인, `totalProgress>=passProgress`면 "이동" 누르지 말고 즉시 종료**(clearInterval + browser.close).
- 세션 만료 시 자동 재로그인·재진입. Discord 하트비트.

## 4. 설문조사 (영상 후 관문)
- 영상 100% 후 `userTestPage.php?like=final` 에 **만족도 설문**(객관식 8 + 주관식 2 = "9.10번 주관식") 표시. 제출해야 시험 진행.
- 제출 후 `survey="Y"`. 이미 제출됐으면 재제출 시 "오류 발생". **survey=Y면 건드리지 말 것.**

## 5. 최종평가(지식 시험) — ⚠️ 1회한정·고난도, 아래 그대로 따를 것
### 진입
- 스터디센터의 `onclick="openTest('final','5066390','WCD7NL','93030',5)"` 요소를 **Playwright `.click()`(신뢰 제스처)로 클릭**.
  - ❌ `page.evaluate(()=>openTest(...))` 는 **팝업 차단**(제스처 없음)으로 안 열림.
- → `userTestPage.php?like=final` **주의사항/서약 페이지**:
  - 동의 체크박스 `onclick="clickCheckbox()"`, "평가보기" 버튼 `onclick="agreeCaution()"`
  - **동의 먼저 체크 → "평가보기"** 순서. 안 그러면 `"평가 응시 유의사항에 동의해주세요"` alert로 막힘.
- "평가보기" → **12문항(라디오) 시험 화면**, 제출버튼 `"제출하기"/"최종제출"`.

### 제약 (주의사항 원문)
- **1회만 응시 가능.** 미수료 시 종료일 **4일 후 4일간 1일 1회** 재응시.
- **"평가보기" 누르는 순간 60분 타이머 시작**, 접속 끊겨도 계속 흐름.
- 최종제출 안 하고 시간 경과 시 **작성된 답안으로 자동 제출**.
- **진행 중 응시는 재진입하면 같은 응시로 resume**(타이머 유지). 브라우저 닫아도 응시는 안 끝남(서버 진행).

### 🔴 커스텀 라디오 = 선택 시마다 재렌더 (가장 중요한 함정)
- 시험 라디오는 선택할 때마다 **사이트 JS가 DOM을 다시 그림**. → 12개를 한 번에 처리하면 **첫 문항만 체크되고 나머지 날아감**.
- **반드시 한 문항씩 순차 + 매번 재조회 + 재렌더 대기(~450ms)**:
  ```js
  // 그룹은 input[type=radio]를 name별로 묶음. qi=문항index(0~), oi=보기번호(1~)
  await frame.evaluate(({qi,oi})=>{
    const groups=[],byName={};
    document.querySelectorAll('input[type="radio"]').forEach(r=>{const n=r.name||('_'+groups.length);if(!byName[n]){byName[n]=[];groups.push(byName[n]);}byName[n].push(r);});
    const inp=groups[qi]?.[oi-1]; if(!inp)return;
    inp.checked=true;
    inp.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    const lbl=(inp.id&&document.querySelector(`label[for="${inp.id}"]`))||inp.closest('label');
    if(lbl&&lbl!==inp){try{lbl.click();}catch(e){}}
  },{qi,oi});
  await page.waitForTimeout(450);
  ```
- 검증: `input[type=radio]:checked` 수가 문항수와 같은지 확인 후 제출. (부족하면 제출 중단=안전)
- 제출 확인창 `"최종 제출시 변경 불가능합니다. 제출하시겠습니까?"` → accept → `"제출됐습니다."` (dialog 핸들러 accept)

## 6. Gemini 풀이 + 교차검증
- Gemini `gemini-2.5-flash` (키 `.env.json` `geminiApiKey`). REST: `…/v1beta/models/gemini-2.5-flash:generateContent?key=`
- **객관식 추출**: name별 라디오 그룹 = 문항, 보기 텍스트는 label/closest로. 문항전문을 로그로 남겨 Claude가 직접 교차검증.
- **검증 조합(추천)**: Gemini 텍스트 3회 다수결 + 스크린샷 비전 + Claude(에이전트) 독립풀이. 불일치 문항만 사람이 확인.
- ⚠️ **Gemini Flash는 함정 문항(맥락 구분)에서 틀림.** 예: 생활사건=가족건강을 Flash가 오답. **Gemini Pro/Claude 추론이 더 정확.** 내용형 문항은 반드시 교차검증.

## 7. Discord 알림 / 자격증명 (모두 `.env.json`, git 제외)
- **봇 토큰+채널 재사용**(다른 사내 프로젝트와 동일): `.env.json`의 `discordToken`·`discordChannelId`. 봇 REST API(`/channels/{id}/messages`)로 임베드 전송(웹훅 아님).
- `geminiApiKey` 도 동일 키 재사용. (모든 값은 `.env.json`, git 제외)

## 8. 파일 구성
| 파일 | 용도 |
|------|------|
| `watch.js` | 영상 자동수강(headed, 차시팝업/퀴즈/세션복구/완료감지/Discord) |
| `exam.js` | 최종평가 진입+2차교차검증 풀이(제출 안 함) |
| `submit.js` | 진입+검증답안 체크+최종제출 (커스텀 라디오 순차선택) |
| `enter.js` | 주의사항/동의 화면까지만 진입(시험 미시작) |
| `.env.json` | userId/password/discordToken/discordChannelId/geminiApiKey (git 제외) |

## 9. 다음번 빠른 처리 체크리스트
1. `node watch.js` → 영상 끝까지 수강(진도 100%까지). 마지막 차시 wrap-around는 진도 API 가드로 자동 종료.
2. 만족도 설문(객관식 8 매우만족 + 주관식 2 일반응답) 제출 → `survey=Y`.
3. **최종평가는 1회한정** → 시작 전 사용자 확인. `openTest('final')` 요소 **실제 클릭** → 동의체크 → 평가보기.
4. 12문항 **한 문항씩 순차 체크**(커스텀 라디오) → Gemini+Claude 교차검증 → 제출.
5. 제출 후 `apiStudyChapter.php`로 `testStatus`/점수 확인.

## 10. 트러블슈팅 요약
- 스크립트 죽이면 **브라우저 창이 닫힘** → 사용자 시야에서 시험창 사라짐. 시험 중엔 절대 죽이지 말 것(응시는 서버에서 resume되지만 혼란/시간손실).
- 진입 안 되면 사용자에게 화면에서 "최종평가" **직접 클릭** 요청 후, 스크립트는 모든 page를 폴링(~5분)하며 문항 도달 시 이어받기.
- `_*.js`(언더스코어)는 일회성 진단 스크립트 — 사용 후 삭제.

## 11. skillflo classroom형(B: 27962 등) 전용 — "기존 시청중" 팝업 (2026-06-04 규명)
- 강의 보기→수강하기로 진입 시 **"기존에 시청중인 강의가 있습니다. 중단하고 새로 시청하시겠습니까? [아니오][예]"** DOM 모달이 뜸(modal/dialog 클래스 없는 평범한 div+fc-button. MODAL_SEL 로 안 잡히니 **문구 텍스트로 감지**).
- ✅ **검증된 동작(중요)**:
  - **「예」 = 팝업 닫고 영상 재생 진입 → 기존 위치에서 이어재생**(72%지점서 resume 확인). **진도 초기화 아님**(완료 차시·전체 진도율 유지). → **「예」가 정답.** `declineResetPopup()`가 「예」 클릭.
  - ❌ **「아니오」 = 강의실 이탈(코스페이지로 빠짐, 영상 안 켜짐)** → 재진입하면 팝업 무한반복. (이름과 반대로 동작하니 주의)
  - ❌ **ESC = 이 팝업엔 안 먹힘**(영상요소가 팝업 뒤에 있어 "닫힘"으로 오판하기 쉬움 — 실제론 안 닫힘).
- 사용자에게 처음엔 "예 누르면 초기화" 우려가 있었으나 **실측상 초기화 안 됨**. 그래도 첫 「예」 후 **수강률(헤더 "수강률:X%")이 유지되는지 확인**할 것. `_yesCount`로 반복 횟수 로깅(8회↑면 경고).
- **진입 속도**: `networkidle`은 영상 스트리밍 때문에 안 끝나 ~80초 지연 → `openPlayer`는 `domcontentloaded`로. 진입 직후 0.3초 간격으로 팝업 즉시 「예」 처리 후 영상 잡히면 루프 종료.
- 영상=kollus iframe `v.kr.kollus.com`, 차시 자동전환(영상 끝나면 다음 영상 src로 자동 교체) — modulearning형의 "다음 차시 이동" 팝업과 달리 별도 클릭 거의 불필요.

## 12. classroom형 새 과정 빠른 수강 절차 (에이전트용 체크리스트, 2026-06-06)
1. **새 과정 식별자 확보**: 로그인 세션으로 `/mypage/course` 방문, `course-progress` 응답 가로채기(`page.on('response')`, 직접 fetch는 CORS). `ongoingCourses[]`에서 미수강 과정의 `id`(courseId)·`product.id`(productId) 추출. (완료 과정도 ongoing에 잔존하니 헤더 수강률로 미완 구분.)
2. **수강 실행**: `COURSE_ID=<id> PRODUCT_ID=<pid> SPEED=2 node watch.js` (headed). 진입 후 「기존 시청중」 팝업이 뜨면 자동 「예」 처리(§11), 안 뜨면 바로 재생. 2배속.
3. **장시간 진행**: Monitor로 `영상 완료|마지막 차시|설문|최종평가|오류|throw|멈춤 의심` 감시. "🎉 마지막 차시 도달"이 완료 신호.
4. **완료 검증(필수)**: classroom 헤더 **수강률 100% & 수강시간==강의시간** 확인(로그인 포함한 일회성 스크립트로). watch.js의 "마지막 차시" 감지는 정확했으나 항상 수강률로 교차확인.
5. **수료기준**: 이 계열은 **진도율 100%면 수료**(시험·과제 0점 무관). 단, 과정에 따라 영상 후 설문/최종평가가 있을 수 있음(modulearning형 §4·5 참조) — 뜨면 사용자 확인.

## 13. 로그인·세션·진도확인 주의 (2026-06-06 갱신)
- **로그인 폼 변경**: `/auth/signin` = `"사번을 입력해주세요" + "로그인하기"` 단일폼(옛 username→"계속하기"→password 2단계 아님). `login()`은 유연 처리(첫 input에 사번 → 계속하기/로그인하기/로그인/submit → 비번칸 있으면 입력 → storageState 저장).
- **세션 만료 잦음**: state.json이 자주 만료 → 진단/확인 스크립트도 **로그인 분기 포함**할 것. watch.js login()은 `looksLoggedIn`(url + "사번을 입력/로그인하기" 부재)로 판정.
- **진도 확인**: classroom 헤더 정규식 `수강률[:\s]*([\d.]+)%.*?수강시간[:\s]*([\d:]+).*?강의시간[:\s]*([\d:]+)`. 코스 인포카드는 React 로딩 느려 ?로 나올 수 있음 → 헤더 우선.
- ⚠️ **「예」 클릭 등 진도 영향 동작은 auto-mode classifier가 차단할 수 있음** — 사용자에게 데이터(아니오=재생불가, 예=초기화안됨)로 설명하고 권한 받은 뒤 진행.

## 14. 완료 현황 (2026-06-06)
| courseId/productId | 과정 | 형태 | 상태 |
|---|---|---|---|
| 27918 / 21159 | 보건업 안전보건 12차시 | modulearning | ✅ 영상완주+시험제출 |
| 27962 / 21048 | 기본의무 교수/의사직 50구성 | classroom | ✅ 진도율 100% |
| 32052 / 22013 | 취약환자 법정교육 합본(단일4h40m) | classroom | ✅ 진도율 100% |
