// ─────────────────────────────────────────────────────────────────────────
// auto-lecture : 강의 자동 수강기
//
// 브라우저 창을 띄운 채 실행(headed). 차시 이동 팝업·중간 확인·퀴즈/평가
// 자동 처리, 세션 만료 시 자동 재로그인, 진도 반영용 주기적 상호작용 포함.
// ─────────────────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '.env.json'), 'utf8'));

const COURSE = {
  courseId: process.env.COURSE_ID || '27918',
  productId: process.env.PRODUCT_ID || '21159',
};

// 기본은 "보이게(headed)" 실행. HEADLESS=1/true 일 때만 창 없이 실행(권장 안 함).
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const POLL_MS = Number(process.env.POLL_MS || cfg.pollIntervalMs || 5000);
const UI_SCAN_MS = Number(process.env.UI_SCAN_MS || cfg.uiScanIntervalMs || 2500);
// 영상 재생 배속 (기본 2배속). SPEED 환경변수 또는 .env.json playbackRate 로 조정.
const PLAYBACK_RATE = Number(process.env.SPEED || cfg.playbackRate || 2);

// Gemini (시험/퀴즈 정답 풀이용) — 키 없으면 첫 보기 찍기로 폴백
const GEMINI_KEY = cfg.geminiApiKey || cfg.geminiKey || '';
const GEMINI_MODEL = cfg.geminiModel || 'gemini-2.5-flash';

const log = (...a) => console.log(new Date().toLocaleTimeString('ko-KR'), ...a);
const STATE_PATH = path.join(__dirname, 'state.json');

// 레벨별 색상·아이콘 (다른 프로젝트의 임베드 알림 스타일과 통일)
const NOTIFY_LEVELS = {
  start:   { color: 0x5865f2, icon: '🚀' }, // 파랑
  info:    { color: 0x95a5a6, icon: '📚' }, // 회색
  success: { color: 0x2ecc71, icon: '✅' }, // 초록
  warn:    { color: 0xe67e22, icon: '⚠️' }, // 주황
  error:   { color: 0xe74c3c, icon: '🛑' }, // 빨강
};

// 디스코드 전송 경로 결정: 봇 토큰+채널 우선, 없으면 웹훅
const BOT_TOKEN = cfg.discordToken;
const BOT_CHANNEL = cfg.discordChannelId;
const WEBHOOK_URL = (cfg.discordWebhook && !/붙여넣기/.test(cfg.discordWebhook)) ? cfg.discordWebhook : null;
const DISCORD_ON = !!(BOT_TOKEN && BOT_CHANNEL) || !!WEBHOOK_URL;

async function sendEmbed(embed) {
  // 봇 REST API (다른 프로젝트와 같은 토큰/채널 재사용)
  if (BOT_TOKEN && BOT_CHANNEL) {
    return fetch(`https://discord.com/api/v10/channels/${BOT_CHANNEL}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }
  // 폴백: 웹훅
  return fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

const _notified = new Map();
// notify(메시지, { level, force, cooldownMs, fields })
//  - level: start|info|success|warn|error (기본 info)
//  - fields: [{ name, value, inline }] 형태의 임베드 필드(선택)
async function notify(msg, { level = 'info', force = false, cooldownMs = 60000, fields } = {}) {
  if (!DISCORD_ON) return;
  const last = _notified.get(msg) || 0;
  if (!force && Date.now() - last < cooldownMs) return;
  _notified.set(msg, Date.now());

  const { color, icon } = NOTIFY_LEVELS[level] || NOTIFY_LEVELS.info;
  const embed = {
    title: `${icon} 강의 자동 수강`,
    description: msg,
    color,
    timestamp: new Date().toISOString(),
    footer: { text: `과정 ${COURSE.courseId}` },
  };
  if (Array.isArray(fields) && fields.length) embed.fields = fields;

  try {
    const res = await sendEmbed(embed);
    if (res && !res.ok) {
      const body = await res.text().catch(() => '');
      log(`(디스코드 응답 ${res.status}:`, body.slice(0, 120), ')');
    }
  } catch (e) { log('(디스코드 전송 실패:', e.message, ')'); }
}

// ── 공통 유틸 ────────────────────────────────────────────────────────────

function allContexts(page) {
  return page.frames ? page.frames() : [page];
}

function isLoginPage(url = '') {
  return /signin|auth\/|\/login/i.test(url);
}

// 해당 컨텍스트에 "재생 중이거나 끝나지 않은" video가 있는지
async function hasLiveVideo(ctx) {
  return ctx.evaluate(() => {
    const v = document.querySelector('video');
    return !!(v && v.readyState > 0 && !v.ended && (v.duration ? v.currentTime < v.duration - 1.5 : true));
  }).catch(() => false);
}

// ── 버튼 클릭 (모달 스코프 우선) ─────────────────────────────────────────

const MODAL_SEL = '[class*="modal"], [class*="popup"], [class*="layer"], [role="dialog"], .ui-dialog, [class*="dialog"]';
const POPUP_CONFIRM_RE = /다음\s*차시|차시.*이동|이동하시겠|진도|학습\s*완료|확인하시겠|계속\s*학습/i;
// 긍정 버튼 우선순위 — 위에서부터 먼저 시도
const AFFIRM_PRIORITY = [
  /^(예|확인|이동|다음\s*차시로?\s*이동|다음\s*차시)$/,
  /^(다음|계속|이어\s*보기|이어보기)$/,
  /^(완료|수강\s*완료|진도\s*저장|학습\s*확인|학습확인)$/,
];

async function clickButtonIn(scope, re) {
  const candidates = scope.locator(
    'button:visible, a:visible, input[type="button"]:visible, input[type="submit"]:visible, [role="button"]:visible',
  );
  const n = await candidates.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 50); i++) {
    const el = candidates.nth(i);
    const text = (
      (await el.innerText().catch(() => '')) ||
      (await el.getAttribute('value').catch(() => '')) ||
      ''
    ).trim();
    if (text && re.test(text)) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ force: true, timeout: 3000 }).catch(() => {});
      return text;
    }
  }
  return null;
}

// 모달이 떠 있으면 모달 안에서 먼저, 없으면 전체에서 클릭
async function clickAffirmative(ctx, reList = AFFIRM_PRIORITY) {
  const modal = ctx.locator(MODAL_SEL).filter({ has: ctx.locator('button:visible, a:visible, [role="button"]:visible') }).first();
  const hasModal = await modal.count().catch(() => 0);
  const scopes = hasModal ? [modal, ctx] : [ctx];
  for (const re of reList) {
    for (const scope of scopes) {
      const label = await clickButtonIn(scope, re);
      if (label) return label;
    }
  }
  return null;
}

// ── 팝업 / 중간 확인 처리 (고도화) ───────────────────────────────────────

// 실제로 "보이는" 모달 중 확인 텍스트를 가진 것만 반환
async function getVisibleConfirmModal(ctx, re) {
  const modals = ctx.locator(MODAL_SEL);
  const n = await modals.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 15); i++) {
    const m = modals.nth(i);
    if (!(await m.isVisible().catch(() => false))) continue;
    const t = (await m.innerText().catch(() => '')) || '';
    if (re.test(t)) return m;
  }
  return null;
}

// "현재 영상 수강 후 넘어갈 수 있습니다" 류 차단 안내 팝업 — 넘어가지 말고 닫기만
const BLOCKER_RE = /수강\s*후|시청\s*후|끝까지|넘어갈\s*수\s*있|학습\s*후.*이동|아직.*완료/i;
async function dismissBlockerPopup(ctx) {
  const modal = await getVisibleConfirmModal(ctx, BLOCKER_RE);
  if (!modal) return false;
  const label = await clickButtonIn(modal, /^(확인|닫기|ok|close)$/i);
  if (label) {
    log('안내 팝업 닫음:', label);
    return true;
  }
  // 버튼이 없으면 ESC로 닫기 시도
  await ctx.keyboard?.press?.('Escape').catch(() => {});
  return false;
}

// "기존에 시청중인 강의가 있습니다. 중단하고 새로 시청하시겠습니까? [아니오][예]"
//  → '예' = 처음부터 새로(진도 초기화!), '아니오' = 기존 이어보기. 반드시 '아니오'만 클릭.
// skillflo classroom 팝업은 modal/dialog 클래스가 없는 평범한 div+button 구조라
// MODAL_SEL 로는 못 잡힘. 문구가 보이면 「아니오」 버튼을 직접 클릭한다.
const RESET_POPUP_RE = /중단하고\s*새로|기존에?\s*시청\s*중|시청\s*중인\s*강의|새로\s*시청하시/i;
// "기존에 시청중인 강의가 있습니다. 중단하고 새로 시청하시겠습니까? [아니오][예]"
// 검증 결과(2026-06-04): 「아니오」=강의실 이탈(코스페이지, 영상 안 켜짐), ESC=안 먹힘.
// 「예」 만이 팝업을 닫고 영상을 재생시킴. 「예」는 현재 보던 클립만 처음부터일 뿐
// 완료 강의·전체 진도는 유지(어차피 전 과정 재수강). → 사용자 승인 하에 「예」 클릭.
let _yesCount = 0;
async function declineResetPopup(ctx) {
  const warn = ctx.locator('text=/중단하고\\s*새로\\s*시청|기존에?\\s*시청\\s*중인?\\s*강의/').first();
  const present = (await warn.count().catch(() => 0)) > 0
    && (await warn.isVisible().catch(() => false));
  if (!present) return false;

  const yes = ctx.locator('button, a, [role="button"]')
    .filter({ hasText: /^\s*예\s*$/ })
    .locator('visible=true').first();
  if ((await yes.count().catch(() => 0)) > 0) {
    await yes.click({ timeout: 3000 }).catch(() => {});
    _yesCount += 1;
    log(`「기존 시청중」 팝업 → 「예」 클릭(영상 재생 진입) [${_yesCount}회]`);
    if (_yesCount >= 8) log('⚠️ 「예」 반복 다수 — 진도 손실 가능, 수강률 확인 요망');
    return true;
  }
  return false;
}

async function handleNextChapterPopup(ctx) {
  // 페이지 전체가 아니라 "확인 문구가 보이는 모달" 안에서만 클릭 (상시 '다음' 버튼 오클릭 방지)
  const modal = await getVisibleConfirmModal(ctx, POPUP_CONFIRM_RE);
  if (!modal) return false;

  log('「차시 이동/확인」 모달 감지');
  for (const re of AFFIRM_PRIORITY) {
    const label = await clickButtonIn(modal, re);
    if (label) {
      log('모달 버튼 클릭:', label);
      return true;
    }
  }

  // 텍스트 노드 "예"만 있는 경우 폴백 (모달 내부 한정)
  const yes = modal.locator('text=예').locator('visible=true').first();
  if (await yes.isVisible({ timeout: 300 }).catch(() => false)) {
    await yes.click({ force: true }).catch(() => {});
    log('모달: 예 클릭');
    return true;
  }
  return false;
}

async function handleMidConfirm(ctx) {
  const body = await ctx.locator('body').innerText().catch(() => '');
  const hint = /학습\s*확인|중간\s*확인|이해했습니다|내용을\s*확인|진도\s*확인|확인하고\s*다음/.test(body);
  // 영상이 살아있으면 중간 확인 버튼은 굳이 누르지 않음(오클릭 방지)
  if (!hint) return false;
  const label = await clickButtonIn(ctx, /^(확인|예|다음|계속|학습\s*확인|학습확인)$/);
  if (label) {
    log('중간 확인 클릭:', label);
    return true;
  }
  return false;
}

// ── 시험/퀴즈 정답 풀이 (Gemini) ─────────────────────────────────────────

// Gemini 호출 — 프롬프트 → 텍스트 응답
async function askGemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
    if (!r.ok) {
      log('(Gemini 응답 오류', r.status, ')');
      return null;
    }
    const j = await r.json();
    return j.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    log('(Gemini 호출 실패:', e.message, ')');
    return null;
  }
}

// 화면에서 문항(질문+보기)을 구조화 추출. 각 보기 input 에 data-aqid 부여.
async function extractQuestions(ctx) {
  return ctx.evaluate(() => {
    let cnt = 0;
    const optionLabel = (input) => {
      let t = '';
      if (input.id) {
        const lb = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lb) t = lb.innerText;
      }
      if (!t && input.closest('label')) t = input.closest('label').innerText;
      if (!t) {
        const row = input.closest('li,tr,td,p,span,div');
        if (row) t = row.innerText;
      }
      return (t || input.value || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    };

    const groups = [];
    const byName = {};
    // 라디오: name 으로 그룹 = 문항
    document.querySelectorAll('input[type="radio"]').forEach((r) => {
      const name = r.name || `__r${cnt++}`;
      if (!byName[name]) { byName[name] = { type: 'radio', inputs: [] }; groups.push(byName[name]); }
      byName[name].inputs.push(r);
    });
    // 체크박스: 가까운 컨테이너로 그룹 = 복수정답 문항
    const byCont = new Map();
    document.querySelectorAll('input[type="checkbox"]').forEach((c) => {
      const cont = c.closest('fieldset,ul,ol,table,form') || c.parentElement || document.body;
      if (!byCont.has(cont)) { const g = { type: 'checkbox', inputs: [] }; byCont.set(cont, g); groups.push(g); }
      byCont.get(cont).inputs.push(c);
    });

    const allInputs = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
    const questions = [];
    for (const g of groups) {
      const inputs = g.inputs;
      if (!inputs.length) continue;
      // 이 문항의 보기들을 모두 포함하는 공통 조상
      let anc = inputs[0].parentElement;
      const containsAll = (el) => el && inputs.every((i) => el.contains(i));
      while (anc && !containsAll(anc)) anc = anc.parentElement;
      // 다른 문항의 입력을 포함하지 않는 선에서 최대한 위로 (질문 헤딩 포함, 옆 문항 침범 방지)
      let qa = anc || document.body;
      while (qa.parentElement) {
        const p = qa.parentElement;
        const inputsInParent = allInputs.filter((i) => p.contains(i)).length;
        if (inputsInParent !== inputs.length) break;
        qa = p;
      }
      let qtext = (qa.innerText || '');
      const options = inputs.map((inp) => {
        const id = `aq${cnt++}`;
        inp.setAttribute('data-aqid', id);
        return { id, text: optionLabel(inp) };
      });
      options.forEach((o) => { if (o.text) qtext = qtext.split(o.text).join(' '); });
      qtext = qtext.replace(/\s+/g, ' ').trim().slice(0, 400);
      questions.push({ type: g.type, qtext, options });
    }
    return questions;
  }).catch(() => []);
}

// Gemini 로 정답 보기 id 목록 받기
async function solveWithGemini(questions) {
  const lines = questions.map((q, i) => {
    const head = `${i + 1}. (${q.type === 'checkbox' ? '복수선택' : '단일선택'}) ${q.qtext || '(질문 텍스트 불명)'}`;
    const opts = q.options.map((o) => `   - ${o.id}: ${o.text}`).join('\n');
    return `${head}\n${opts}`;
  }).join('\n\n');

  const prompt =
    '당신은 한국어 객관식 시험 풀이 도우미입니다. 아래 각 문항의 정답인 보기의 id를 고르세요.\n'
    + '- 단일선택은 정확히 1개, 복수선택은 정답인 보기를 모두 선택하세요.\n'
    + '- 반드시 주어진 보기 id(aqN)만 사용하세요.\n'
    + '- 다른 설명 없이 JSON 배열로만 답하세요. 예: ["aq1","aq5"]\n\n'
    + `[문항]\n${lines}`;

  const raw = await askGemini(prompt);
  if (!raw) return null;
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : null;
  } catch { return null; }
}

// ── 퀴즈 / 평가 처리 (고도화) ────────────────────────────────────────────
//
// body 정규식만으로 오탐하던 방식을 버리고,
//  (1) 실제 입력요소(라디오/체크박스) 또는 제출 버튼이 존재하고
//  (2) 같은 화면에 살아있는 영상이 없을 때만
// 트리거. 같은 퀴즈를 반복 제출하지 않도록 처리한 차시는 기억한다.
const _handledQuiz = new Set();

async function handleQuizAndAssessment(ctx, quizKey) {
  // 살아있는 영상이 있으면 퀴즈가 아님 → 건드리지 않음
  if (await hasLiveVideo(ctx)) return false;

  const meta = await ctx.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"]');
    const checks = document.querySelectorAll('input[type="checkbox"]');
    const body = (document.body && document.body.innerText) || '';
    const quizText = /퀴즈|평가|시험|문\s*항|문제\s*\d|객관식|O\s*X|정답|응시|채점/.test(body);
    const names = new Set();
    radios.forEach((r) => r.name && names.add(r.name));
    return {
      radioCount: radios.length,
      radioGroups: [...names],
      checkCount: checks.length,
      quizText,
    };
  }).catch(() => null);

  if (!meta) return false;
  const looksLikeQuiz = (meta.radioCount > 0 || meta.checkCount > 0) && meta.quizText;
  if (!looksLikeQuiz) return false;

  if (quizKey && _handledQuiz.has(quizKey)) {
    // 이미 답안 제출한 퀴즈 — 결과 확인 버튼만(상시 '다음' 나비 버튼은 누르지 않음)
    const next = await clickButtonIn(ctx, /^(결과\s*보기|채점\s*결과|확인)$/);
    if (next) log('퀴즈 결과 확인:', next);
    return !!next;
  }

  log('퀴즈/평가 화면 처리 중...');

  // 1) 문항 구조 추출 (각 보기에 data-aqid 부여)
  const questions = await extractQuestions(ctx);
  let solvedBy = '첫 보기(폴백)';
  let answeredIds = null;

  // 2) Gemini 로 정답 풀이 시도
  if (GEMINI_KEY && questions.length) {
    answeredIds = await solveWithGemini(questions);
    if (answeredIds && answeredIds.length) solvedBy = 'Gemini';
  }

  if (answeredIds && answeredIds.length) {
    // Gemini 가 고른 보기 선택
    for (const id of answeredIds) {
      const el = ctx.locator(`[data-aqid="${id}"]`).first();
      await el.check({ force: true }).catch(async () => {
        await el.click({ force: true }).catch(() => {});
      });
    }
    // 단일선택 문항인데 답이 안 들어간 경우 첫 보기로 보강
    for (const q of questions) {
      if (q.type !== 'radio') continue;
      const ids = q.options.map((o) => o.id);
      if (!ids.some((id) => answeredIds.includes(id))) {
        await ctx.locator(`[data-aqid="${ids[0]}"]`).first().check({ force: true }).catch(() => {});
      }
    }
  } else {
    // 폴백: 문항별 첫 보기 / 체크박스 전체 / OX 라벨
    for (const name of meta.radioGroups) {
      await ctx.locator(`input[type="radio"][name="${name}"]`).first().check({ force: true }).catch(() => {});
    }
    await ctx.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!r.checked && r.name === '') { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      document.querySelectorAll('input[type="checkbox"]').forEach((c) => {
        if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      document.querySelectorAll('label').forEach((lb) => {
        const t = (lb.innerText || '').trim();
        if (/^[1-4①②③④]$/.test(t) || t === 'O' || t === 'X') lb.click();
      });
    }).catch(() => {});
  }

  const submit = await clickButtonIn(ctx, /^(제출|답안\s*제출|확인|채점|결과\s*보기|다음)$/);
  if (submit) {
    if (quizKey) _handledQuiz.add(quizKey);
    log(`퀴즈/평가 제출: ${submit} (풀이: ${solvedBy}, ${questions.length}문항)`);
    notify(`퀴즈/평가 자동 제출 — ${solvedBy} 풀이, ${questions.length}문항 (${submit})`, {
      level: 'success', cooldownMs: 60000,
    });
    return true;
  }
  return false;
}

// ── 설문조사 자동 응답 ───────────────────────────────────────────────────
// 만족도 설문(라디오) — 각 문항에서 긍정 보기(매우만족 등) 선택 후 제출. 정답 개념 없음.
const _handledSurvey = new Set();
async function handleSurvey(ctx, key) {
  if (await hasLiveVideo(ctx)) return false;
  const meta = await ctx.evaluate(() => {
    const body = document.body?.innerText || '';
    const isSurvey = /설문|만족도|만족하셨|소중한\s*의견|설문조사/.test(body);
    const radioCount = document.querySelectorAll('input[type="radio"]').length;
    return { isSurvey, radioCount };
  }).catch(() => null);
  if (!meta || !meta.isSurvey || meta.radioCount === 0) return false;

  if (key && _handledSurvey.has(key)) {
    const next = await clickButtonIn(ctx, /^(확인|다음|닫기)$/);
    if (next) log('설문 결과 진행:', next);
    return !!next;
  }

  log('설문조사 자동 응답 중...');
  // 문항(라디오 그룹)별 긍정 보기 선택 — 없으면 첫 보기
  await ctx.evaluate(() => {
    const positive = /매우\s*만족|매우\s*그렇|매우\s*좋|매우\s*우수|만족|그렇다|우수|좋다|동의|^예$/;
    const labelOf = (r) => {
      let t = '';
      if (r.id) { const l = document.querySelector(`label[for="${CSS.escape(r.id)}"]`); if (l) t = l.innerText; }
      if (!t && r.closest('label')) t = r.closest('label').innerText;
      if (!t) { const row = r.closest('li,tr,td,div,span'); if (row) t = row.innerText; }
      return (t || '').trim();
    };
    const byGroup = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => {
      const k = r.name || (r.closest('li,tr,fieldset,div') ? 'c' + [...document.querySelectorAll('input[type=radio]')].indexOf(r) : 'x');
      (byGroup[k] = byGroup[k] || []).push(r);
    });
    Object.values(byGroup).forEach((group) => {
      const pick = group.find((r) => positive.test(labelOf(r))) || group[0];
      if (pick && !pick.checked) { pick.checked = true; pick.dispatchEvent(new Event('change', { bubbles: true })); pick.click?.(); }
    });
  }).catch(() => {});

  const submit = await clickButtonIn(ctx, /^(제출|등록|완료|확인|저장|다음)$/);
  if (submit) {
    if (key) _handledSurvey.add(key);
    log('설문 제출:', submit);
    notify(`설문조사 자동 제출 (${submit})`, { level: 'success', cooldownMs: 60000 });
    return true;
  }
  return false;
}

async function scanAndHandleUi(player, quizKey) {
  let acted = false;
  for (const ctx of allContexts(player)) {
    try {
      if (await declineResetPopup(ctx)) { acted = true; continue; } // 초기화 팝업 최우선 처리
      if (await dismissBlockerPopup(ctx)) acted = true;
      if (await handleNextChapterPopup(ctx)) acted = true;
      if (await handleSurvey(ctx, quizKey)) acted = true;
      else if (await handleQuizAndAssessment(ctx, quizKey)) acted = true;
      else if (await handleMidConfirm(ctx)) acted = true;
    } catch { /* frame 전환 중 */ }
  }
  return acted;
}

// 네이티브 confirm/alert 팝업 — 진행을 막지 않도록 모두 수락
function attachDialogHandlers(ctx) {
  const onDialog = async (dialog) => {
    const msg = dialog.message() || '';
    log('브라우저 팝업:', msg);
    // "중단하고 새로 시청…"이 네이티브 confirm으로 뜨면 수락=예(영상 재생 진입). 그 외도 수락.
    await dialog.accept().catch(() => {});
  };
  ctx.on('page', (p) => p.on('dialog', onDialog));
  for (const p of ctx.pages()) p.on('dialog', onDialog);
}

// ── 진도·재생 패턴 ───────────────────────────────────────────────────────

async function simulateProgressEngagement(player, vf) {
  const x = 120 + Math.floor(Math.random() * 400);
  const y = 120 + Math.floor(Math.random() * 300);
  await player.mouse.move(x, y).catch(() => {});

  if (vf) {
    await vf.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        if (v.paused && !v.ended) v.play?.();
      }
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      try {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      } catch { /* ignore */ }
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    }).catch(() => {});
  }
}

// 영상 종료 후 진행 — 페이지의 상시 '다음' 나비 버튼이 아니라
// "다음 차시로 이동하시겠습니까?" 확인 팝업(swal2 등)의 '이동' 버튼만 클릭
async function tryAdvanceAfterVideo(player) {
  for (const ctx of allContexts(player)) {
    const modal = await getVisibleConfirmModal(ctx, /다음\s*차시|이동하시겠/);
    if (!modal) continue;
    const label = await clickButtonIn(modal, /^(이동|예|확인|다음\s*차시로?\s*이동|다음\s*차시)$/);
    if (label) {
      log('차시 이동 팝업 클릭:', label);
      return true;
    }
  }
  return false;
}

// ── 로그인·플레이어 진입 ─────────────────────────────────────────────────

async function login(page) {
  await page.goto(cfg.baseUrl + '/mypage/course', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const looksLoggedIn = !isLoginPage(page.url())
    && !/사번을\s*입력|로그인하기/.test(await page.content().catch(() => ''));
  if (looksLoggedIn) {
    log('로그인 생략 (세션 유지)');
    return;
  }

  log('로그인 중...');
  await page.goto(cfg.baseUrl + '/auth/signin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // 사번(아이디) 입력 — name="username" 우선, 없으면 첫 보이는 입력칸
  const idInput = page.locator('input[name="username"]:visible, input[type="text"]:visible, input:visible').first();
  await idInput.fill(cfg.userId).catch(() => {});
  // 계속하기/로그인하기/로그인/다음 중 보이는 버튼
  await page.locator('button:has-text("계속하기"), button:has-text("로그인하기"), button:has-text("로그인"), button:has-text("다음"), button[type="submit"]').first().click().catch(() => {});
  await page.waitForTimeout(1800);
  // 비밀번호 단계가 있으면 입력
  const pw = page.locator('input[type="password"]:visible').first();
  if (await pw.count().catch(() => 0)) {
    await pw.fill(cfg.password).catch(() => {});
    await page.locator('button:has-text("계속하기"), button:has-text("로그인하기"), button:has-text("로그인"), button[type="submit"]').first().click().catch(() => {});
  }
  await page.waitForTimeout(2500);
  await page.context().storageState({ path: STATE_PATH }).catch(() => {});
  log('로그인 완료:', page.url());
}

async function openPlayer(ctx, page) {
  log('강의 진입 중...');
  // networkidle 은 영상 스트리밍 때문에 안 끝나서 진입이 느려짐 → domcontentloaded 로 빠르게
  await page.goto(
    `${cfg.baseUrl}/course/${COURSE.courseId}?productId=${COURSE.productId}&tab=info`,
    { waitUntil: 'domcontentloaded' },
  ).catch(() => {});
  await page.waitForTimeout(1000);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const [popup] = await Promise.all([
    page.waitForEvent('popup').catch(() => null),
    btn.click({ force: true }).catch(() => {}),
  ]);
  const modu = popup || page;
  await modu.waitForLoadState('domcontentloaded').catch(() => {});
  await modu.waitForTimeout(1200);
  await modu.locator('text=수강하기').locator('visible=true').first().click({ force: true }).catch(() => {});

  const player = ctx.pages().find((p) => /\/classroom\/|studyView/.test(p.url())) || modu;
  // 진입 직후 "기존 시청중" 초기화 팝업을 뜨는 즉시(0.3초 간격) ESC로 닫고, 영상 잡히면 종료
  for (let i = 0; i < 40; i++) {
    for (const f of allContexts(player)) {
      try { await declineResetPopup(f); } catch { /* frame 전환 중 */ }
    }
    if (await findVideoFrame(player)) break;
    await player.waitForTimeout(300);
  }
  await player.bringToFront().catch(() => {});
  log('플레이어 진입:', player.url());
  return player;
}

async function findVideoFrame(player) {
  if (player.isClosed()) return null;
  for (const f of player.frames()) {
    try { if (await f.$('video')) return f; } catch { /* cross-origin */ }
  }
  return null;
}

// 수료/진도 상태 조회 (modulearning 챕터 API) — 완료 감지·재수강 방지용
async function fetchCourseStatus(player) {
  try {
    if (player.isClosed()) return null;
    const u = new URL(player.url());
    const contentsCode = u.searchParams.get('contentsCode');
    const lectureOpenSeq = u.searchParams.get('lectureOpenSeq');
    const studySeq = u.searchParams.get('studySeq');
    if (!contentsCode || !lectureOpenSeq || !studySeq) return null;
    const api = `https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=${contentsCode}&lectureOpenSeq=${lectureOpenSeq}&studySeq=${studySeq}`;
    const r = await player.request.get(api);
    if (!r.ok()) return null;
    const j = await r.json();
    if (!j || j.totalCount === '0') return null;
    return {
      certPass: j.certPass,                       // 'Y' = 수료 통과 (단독 신뢰 불가)
      totalProgress: Number(j.totalProgress || 0),
      passProgress: Number(j.passProgress || 0),  // 이수 기준 진도
      finalTestProgress: Number(j.finalTestProgress || 0),
      testStatus: j.testStatus,                   // 'Y'/'N' 최종시험 응시
      testScore: j.testScore == null ? null : Number(j.testScore),
      passScore: Number(j.passScore || 0),
      certDate: j.certDate,
    };
  } catch { return null; }
}

// 영상(진도) 100% 충족 여부 — certPass 는 신뢰 불가(미완료인데 Y인 사례 확인됨)라 진도로만 판단
function isProgressComplete(s) {
  return !!s && s.passProgress > 0 && s.totalProgress >= s.passProgress;
}
// 시험까지 끝났는가 (응시 완료 또는 합격점 이상)
function isExamDone(s) {
  if (!s) return false;
  if (s.testStatus === 'Y') return true;
  return Number.isFinite(s.testScore) && s.testScore >= (s.passScore || 0) && s.testScore > 0;
}

// 로그아웃/세션만료 감지 시 재로그인 + 플레이어 재진입
async function recoverIfLoggedOut(ctx, page, state) {
  const closed = state.player.isClosed();
  const onLogin = !closed && isLoginPage(state.player.url());
  if (!closed && !onLogin) return false;

  log('⚠️  세션 만료/플레이어 종료 감지 — 재로그인 시도');
  notify('세션이 만료된 것 같아 재로그인 후 다시 진입합니다.', { level: 'warn', force: true });
  try {
    await login(page);
    state.player = await openPlayer(ctx, page);
    state.lastSrc = '';
    log('재진입 완료:', state.player.url());
    notify('재진입 완료, 자동 수강을 이어갑니다.', { level: 'success', force: true });
    return true;
  } catch (e) {
    log('재진입 실패:', e.message);
    notify(`재진입 실패: ${e.message}`, { level: 'error', force: true });
    return false;
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────

async function run() {
  const contextOpts = { viewport: { width: 1280, height: 820 } };
  if (fs.existsSync(STATE_PATH)) contextOpts.storageState = STATE_PATH;

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 30,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'],
  });
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  attachDialogHandlers(ctx);

  await login(page);

  // 가변 상태(재진입 시 player 가 교체됨)
  const state = {
    player: await openPlayer(ctx, page),
    chapter: '-',
    pct: 0,
    cur: 0,
    dur: 0,
    completed: 0,        // 실제로 끝까지 본 영상 수
    lastMoveAt: Date.now(),
    lastSrc: '',
    endStuck: 0,         // 마지막 영상이 끝났는데 진전 없는 횟수
    evalTried: false,    // 최종 '평가보기' 1회 시도 여부
    finished: false,     // 수강 완료/더 진행 불가 판정
  };

  // 시작 전 진도/시험 확인
  const startStatus = await fetchCourseStatus(state.player);
  if (startStatus) {
    log(`현재 진도율 ${startStatus.totalProgress}% / 이수기준 ${startStatus.passProgress}% / 시험 ${isExamDone(startStatus) ? `완료(${startStatus.testScore ?? '?'}점)` : '미응시'}`);
    if (isProgressComplete(startStatus) && isExamDone(startStatus)) {
      log('🎉 진도·시험 모두 완료 — 더 할 작업이 없어 종료합니다.');
      notify(`진도 ${startStatus.totalProgress}% · 시험 완료 — 모든 과정 끝. 종료합니다.`, { level: 'success', force: true });
      await browser.close().catch(() => {});
      return;
    }
    if (isProgressComplete(startStatus)) {
      log('영상 진도는 100% — 시험 응시 단계로 진행합니다.');
    }
  }

  log(`모드: ${HEADLESS ? 'headless' : '창 표시'} | UI 스캔 ${UI_SCAN_MS}ms | 재생 감시 ${POLL_MS}ms`);
  log(`시험 풀이: ${GEMINI_KEY ? `Gemini(${GEMINI_MODEL})` : '첫 보기 찍기(키 없음)'}`);
  log('자동 처리: 차시 이동 팝업 · 중간 확인 · 퀴즈/평가 · 진도 상호작용 · 세션 자동 복구\n');
  notify('자동 수강을 시작했습니다.', { level: 'start', force: true });

  let stalledResumes = 0;
  let lastTime = -1;
  let sameTimeCount = 0;
  let lastEngage = 0;
  const completedSrcs = new Set();

  const startedAt = Date.now();
  const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || cfg.heartbeatMs || 300000);
  const heartbeat = setInterval(() => {
    const mins = Math.round((Date.now() - startedAt) / 60000);
    const stalled = Date.now() - state.lastMoveAt > HEARTBEAT_MS;
    const head = stalled ? '멈춤 의심' : '정상 진행';
    notify(`상태: ${head}`, {
      level: stalled ? 'warn' : 'info',
      force: true,
      fields: [
        { name: '경과', value: `${mins}분`, inline: true },
        { name: '완료 영상', value: `${state.completed}개`, inline: true },
        { name: '현재 진행률', value: `${state.pct}% (${state.cur}/${state.dur}초)`, inline: true },
        { name: '현재 차시', value: `...${state.chapter}`, inline: false },
      ],
    });
    log(`💓 하트비트: ${head} / ${state.pct}% / 완료 ${state.completed}개`);
  }, HEARTBEAT_MS);

  // 주기적 UI 스캔 — 팝업/퀴즈/중간확인 (단일 소스, 중복 호출 없음)
  const uiTimer = setInterval(async () => {
    try { await scanAndHandleUi(state.player, state.lastSrc); } catch { /* ignore */ }
  }, UI_SCAN_MS);

  // 재생 감시 루프
  const timer = setInterval(async () => {
    try {
      if (await recoverIfLoggedOut(ctx, page, state)) return;

      const player = state.player;
      const vf = await findVideoFrame(player);
      if (!vf) {
        const handled = await scanAndHandleUi(player, state.lastSrc);
        if (!handled) {
          state._noVid = (state._noVid || 0) + 1;
          log('⚠️  영상 없음 — 퀴즈/확인 화면일 수 있음, UI 재스캔 중');
          if (state._noVid === 3 && process.env.DIAG_STUCK) {
            try {
              await player.screenshot({ path: path.join(__dirname, '_stuck.png') });
              const btns = await player.evaluate(() => [...document.querySelectorAll('button,[role=button],a')]
                .filter(b => b.offsetParent !== null).map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 40));
              log('STUCK 버튼들:', JSON.stringify(btns));
              log('STUCK url:', player.url());
            } catch (e) { log('STUCK 캡처 실패:', e.message); }
          }
        } else { state._noVid = 0; }
        return;
      }
      state._noVid = 0;

      const st = await vf.$eval('video', (v) => ({
        cur: v.currentTime,
        dur: v.duration || 0,
        paused: v.paused,
        ended: v.ended,
        rate: v.playbackRate,
        src: (v.currentSrc || v.src || ''),
      }));

      if (Math.abs(st.rate - PLAYBACK_RATE) > 0.01) {
        await vf.evaluate((rate) => { const v = document.querySelector('video'); if (v) v.playbackRate = rate; }, PLAYBACK_RATE);
        log(`재생속도 ${PLAYBACK_RATE}배속 고정`);
      }

      const now = Date.now();

      if (st.src && st.src !== state.lastSrc) {
        state.lastSrc = st.src;
        const seg = st.src.split('/').slice(-3).join('/');
        log(`▶ 새 영상: ...${seg} (${Math.round(st.dur)}초)`);
        stalledResumes = 0;
        sameTimeCount = 0;
        state.chapter = seg;
        state.lastMoveAt = now;
        state.endStuck = 0;      // 새 영상 = 진전 있음
        state.finished = false;
        notify(`새 영상 재생 시작 (${Math.round(st.dur)}초)`, { cooldownMs: 180000 });
      }

      if (now - lastEngage > 15000) {
        lastEngage = now;
        await simulateProgressEngagement(player, vf);
      }

      // 영상 종료 → 완료 카운트(중복 방지) 후 다음 진행
      if (st.ended || (st.dur > 0 && st.cur >= st.dur - 1.5)) {
        if (st.src && !completedSrcs.has(st.src)) {
          completedSrcs.add(st.src);
          state.completed += 1;
          state.lastMoveAt = now;
          log(`✅ 영상 완료 (누적 ${state.completed}개)`);
          notify(`영상 완료 — 누적 ${state.completed}개`, { level: 'success', cooldownMs: 60000 });

          // 영상 완료 시점마다 진도 확인 — 진도 100%면 '이동'(wrap-around 재수강) 누르지 않고 멈춤
          const s = await fetchCourseStatus(player);
          if (isProgressComplete(s)) {
            state.finished = true;
            clearInterval(timer);
            clearInterval(uiTimer);
            clearInterval(heartbeat);
            const examMsg = isExamDone(s) ? '시험도 완료' : '※ 시험 미응시 — 시험 응시 필요';
            log(`🎉 영상 진도 100% 도달 (완료 영상 ${state.completed}개). ${examMsg}`);
            notify(
              `영상 진도 100% 완료 (완료 영상 ${state.completed}개). ${examMsg}`,
              { level: 'success', force: true },
            );
            await browser.close().catch(() => {}); // 깔끔히 종료 → 다음(시험) 단계로
            return;
          }
        }

        if (state.finished) return; // 이미 종료 판정 → 더 손대지 않음

        // 다음 차시 팝업의 '이동' 또는 퀴즈/확인 처리 시도
        await scanAndHandleUi(player, state.lastSrc);
        await tryAdvanceAfterVideo(player);
        state.endStuck += 1;

        // 같은 마지막 영상이 끝난 채로 여러 번 진전이 없으면 = 마지막 차시
        if (state.endStuck >= 5) {
          // (1) 최종 '평가보기'가 있으면 1회 진입 시도 → 이후 퀴즈 핸들러가 Gemini로 풀이
          if (!state.evalTried) {
            state.evalTried = true;
            for (const c of allContexts(player)) {
              const ev = await clickButtonIn(c, /^(평가\s*보기|평가\s*하기|최종\s*평가|수료\s*평가|시험\s*보기)$/);
              if (ev) {
                log('최종 평가 진입 시도:', ev);
                notify(`최종 평가 화면 진입 시도: ${ev}`, { level: 'info', force: true });
                state.endStuck = 0;
                return;
              }
            }
          }
          // (2) 더 진행할 항목 없음 → 안내 팝업 닫고 자동 진행 종료(브라우저는 유지)
          for (const c of allContexts(player)) {
            await clickButtonIn(c, /^(닫기|확인)$/).catch(() => {});
          }
          state.finished = true;
          clearInterval(timer);
          clearInterval(uiTimer);
          log('🎉 마지막 차시 도달 — 자동 진행 종료 (브라우저 유지)');
          notify(
            `모든 차시 수강 완료(또는 더 진행 불가) — 완료 영상 ${state.completed}개. `
            + '자동 진행을 멈췄습니다. 화면에서 최종 평가/수료 여부를 확인하세요.',
            { level: 'success', force: true },
          );
        }
        return;
      }

      if (st.paused) {
        await vf.$eval('video', (v) => { v.muted = true; v.play && v.play(); }).catch(() => {});
        await scanAndHandleUi(player, state.lastSrc);
        stalledResumes++;
        if (stalledResumes === 2) await simulateProgressEngagement(player, vf);
        if (stalledResumes === 3 || stalledResumes % 10 === 0) {
          log('⏸  일시정지 — 팝업/확인 자동 처리 시도 중');
        }
        return;
      }
      stalledResumes = 0;

      if (Math.abs(st.cur - lastTime) < 0.3) {
        sameTimeCount++;
        if (sameTimeCount === 4) await scanAndHandleUi(player, state.lastSrc);
        if (sameTimeCount === 8) {
          log('⏸  진행 정체 — UI·재생 재시도');
          await simulateProgressEngagement(player, vf);
          notify('재생이 멈춘 것 같아 자동 복구를 시도했습니다.', { level: 'warn' });
        }
      } else {
        sameTimeCount = 0;
        const pct = st.dur ? Math.round((st.cur / st.dur) * 100) : 0;
        log(`재생 중 ${Math.round(st.cur)}/${Math.round(st.dur)}초 (${pct}%)`);
        state.pct = pct;
        state.cur = Math.round(st.cur);
        state.dur = Math.round(st.dur);
        state.lastMoveAt = now;
      }
      lastTime = st.cur;
    } catch {
      /* 페이지 전환 중 */
    }
  }, POLL_MS);

  browser.on('disconnected', () => {
    clearInterval(timer);
    clearInterval(uiTimer);
    clearInterval(heartbeat);
    notify('수강기가 종료되었습니다.', { level: 'error', force: true });
    log('브라우저 종료');
    process.exit(0);
  });
}

run().catch((e) => { console.error('ERR', e); process.exit(1); });
