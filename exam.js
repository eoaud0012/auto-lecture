// 최종평가 2차 교차검증 풀이: 진입 → 1차(텍스트) Gemini → 2차(스크린샷 비전) Gemini → 대조 → 선택(제출 X) → 디스코드
// 시험 제출은 사람이 직접. 설문(완료)은 건드리지 않음.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '.env.json'), 'utf8'));
const STATE = path.join(__dirname, 'state.json');
const COURSE = { courseId: '27918', productId: '21159' };
const GEMINI_KEY = cfg.geminiApiKey;
const GEMINI_MODEL = cfg.geminiModel || 'gemini-2.5-flash';
const log = (...a) => console.log(new Date().toLocaleTimeString('ko-KR'), ...a);

async function notify(msg, { fields, level = 'info' } = {}) {
  const colors = { info: 0x5865f2, success: 0x2ecc71, warn: 0xe67e22, error: 0xe74c3c };
  const embed = { title: '📝 최종평가 2차검증 풀이', description: msg, color: colors[level], timestamp: new Date().toISOString() };
  if (fields?.length) embed.fields = fields;
  try {
    if (cfg.discordToken && cfg.discordChannelId) {
      await fetch(`https://discord.com/api/v10/channels/${cfg.discordChannelId}/messages`, {
        method: 'POST', headers: { Authorization: `Bot ${cfg.discordToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
    }
  } catch (e) { log('(디스코드 실패:', e.message, ')'); }
}

async function gemini(parts) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } }),
  });
  if (!r.ok) { log('Gemini 오류', r.status, (await r.text()).slice(0, 150)); return null; }
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

const EXTRACT = () => {
  let cnt = 0;
  const optionLabel = (input) => {
    let t = '';
    if (input.id) { const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`); if (l) t = l.innerText; }
    if (!t && input.closest('label')) t = input.closest('label').innerText;
    if (!t) { const row = input.closest('li,tr,td,p,span,div'); if (row) t = row.innerText; }
    return (t || input.value || '').trim().replace(/\s+/g, ' ').slice(0, 220);
  };
  const groups = []; const byName = {};
  document.querySelectorAll('input[type="radio"]').forEach((r) => {
    const name = r.name || `__r${cnt++}`;
    if (!byName[name]) { byName[name] = { type: 'radio', inputs: [] }; groups.push(byName[name]); }
    byName[name].inputs.push(r);
  });
  const allInputs = [...document.querySelectorAll('input[type="radio"]')];
  const questions = [];
  for (const g of groups) {
    const inputs = g.inputs; if (!inputs.length) continue;
    let anc = inputs[0].parentElement;
    const containsAll = (el) => el && inputs.every((i) => el.contains(i));
    while (anc && !containsAll(anc)) anc = anc.parentElement;
    let qa = anc || document.body;
    while (qa.parentElement) { const p = qa.parentElement; if (allInputs.filter((i) => p.contains(i)).length !== inputs.length) break; qa = p; }
    let qtext = (qa.innerText || '');
    const options = inputs.map((inp) => { const id = `aq${cnt++}`; inp.setAttribute('data-aqid', id); return { id, text: optionLabel(inp) }; });
    options.forEach((o) => { if (o.text) qtext = qtext.split(o.text).join(' '); });
    qtext = qtext.replace(/언어 선택[\s\S]*?(?=\d|문제|$)/, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    questions.push({ type: g.type, qtext, options });
  }
  return questions;
};

const looksLikeSurvey = (qs) => qs.length > 0 && qs.filter((q) => q.options.some((o) => /그렇다|만족|보통이다/.test(o.text))).length >= Math.max(2, Math.floor(qs.length / 2));
const looksLikeConsent = (qs) => qs.length > 0 && qs.every((q) => /숙지|동의|공정|응시하겠|확인하였|읽었/.test(q.qtext + q.options.map((o) => o.text).join(' ')));
const isExam = (qs) => qs.length >= 2 && !looksLikeSurvey(qs) && !looksLikeConsent(qs);

async function findQuizFrame(page) {
  try { if (await page.$('input[type="radio"]')) return page.mainFrame(); } catch {}
  for (const f of page.frames()) { try { if (await f.$('input[type="radio"]')) return f; } catch {} }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, storageState: fs.existsSync(STATE) ? STATE : undefined });
  ctx.on('page', (p) => p.on('dialog', (d) => { log('팝업:', d.message().slice(0, 70)); d.accept().catch(() => {}); }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => { log('팝업:', d.message().slice(0, 70)); d.accept().catch(() => {}); });

  await page.goto(cfg.baseUrl + '/mypage/course', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  if (/signin|auth/i.test(page.url())) {
    log('로그인 중...');
    await page.goto(cfg.baseUrl + '/auth/signin', { waitUntil: 'networkidle' });
    await page.fill('input[name="username"]', cfg.userId);
    await page.click('button:has-text("계속하기")');
    await page.waitForTimeout(1200);
    await page.locator('input[type="password"]:visible').first().fill(cfg.password);
    await page.locator('button:has-text("계속하기"), button:has-text("로그인")').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    await ctx.storageState({ path: STATE }).catch(() => {});
  }

  await page.goto(`${cfg.baseUrl}/course/${COURSE.courseId}?productId=${COURSE.productId}&tab=info`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const [pop] = await Promise.all([page.waitForEvent('popup').catch(() => null), btn.click({ force: true }).catch(() => {})]);
  const modu = pop || page;
  await modu.waitForLoadState('networkidle').catch(() => {});
  await modu.waitForTimeout(3500);

  log('최종평가 버튼 실제 클릭(팝업 허용)...');
  // evaluate(openTest) 는 사용자 제스처가 없어 팝업이 차단됨 → 버튼을 Playwright 로 직접 클릭(=신뢰 제스처)
  let popup = null;
  const finalBtn = modu.locator("[onclick*=\"openTest('final'\"], [onclick*='openTest(\"final\"']").first();
  try {
    [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 12000 }).catch(() => null),
      finalBtn.click({ force: true, timeout: 8000 }),
    ]);
  } catch (e) {
    log('최종평가 직접 클릭 실패:', e.message, '— evaluate 폴백');
    await modu.evaluate(() => { try { openTest('final', '5066390', 'WCD7NL', '93030', 5); } catch (er) {} }).catch(() => {});
  }
  if (popup) { await popup.waitForLoadState('networkidle').catch(() => {}); log('시험 팝업 열림:', popup.url()); }
  await page.waitForTimeout(3500);

  // 주의사항/서약 페이지면 동의 클릭 → 평가보기 (자동 통과)
  const passAgreement = async (pg) => {
    try {
      const isCaution = await pg.evaluate(() => /숙지하였으며|공정하게 평가|주의사항/.test(document.body?.innerText || '')).catch(() => false);
      if (!isCaution) return;
      const agree = pg.locator('[onclick*="clickCheckbox"], :text("위 사항을 모두 숙지")').locator('visible=true').first();
      await agree.click({ force: true }).catch(() => {});
      await pg.evaluate(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }); }).catch(() => {});
      await pg.waitForTimeout(400);
      const view = pg.locator('text=평가보기, [onclick*="agreeCaution"]').locator('visible=true').first();
      if (await view.isVisible({ timeout: 800 }).catch(() => false)) { log('동의 후 평가보기 클릭'); await view.click({ force: true }).catch(() => {}); }
      await pg.waitForTimeout(2500);
    } catch { /* navigation 등 무시 */ }
  };

  // 최대 ~100초 동안 모든 페이지에서 시험 문항 탐색 (자동 통과 + 사용자 수동 조작도 허용)
  let exam = null; let frame = null; let questions = [];
  for (let t = 0; t < 33 && !questions.length; t++) {
    for (const pg of ctx.pages()) {
      try {
        if (pg.isClosed() || !/modulearning|userTestPage|studyView|study\.php/.test(pg.url())) continue;
        await passAgreement(pg);
        const fr = await findQuizFrame(pg);
        if (fr) { const qs = await fr.evaluate(EXTRACT); if (isExam(qs)) { exam = pg; frame = fr; questions = qs; break; } }
      } catch { /* ignore */ }
    }
    if (!questions.length) { if (t % 3 === 0) log(`시험 문항 탐색 중... (${t * 3}s, 열린창 ${ctx.pages().length})`); await page.waitForTimeout(3000); }
  }

  if (!exam || !isExam(questions)) {
    exam = exam || ctx.pages().find((p) => /userTestPage/.test(p.url())) || modu;
    await notify(`시험 문항에 도달하지 못했습니다. 화면에서 '최종평가 → 평가보기'를 직접 눌러주시면 자동으로 풀이합니다. (창 유지)\nURL: ${exam.url()}`, { level: 'warn' });
    log('도달 실패 — 사용자 수동 진입 대기. URL:', exam.url());
    // 추가로 3분간 더 폴링(사용자가 직접 평가보기 누르면 잡음)
    for (let t = 0; t < 60 && !questions.length; t++) {
      for (const pg of ctx.pages()) {
        try { if (pg.isClosed()) continue; const fr = await findQuizFrame(pg); if (fr) { const qs = await fr.evaluate(EXTRACT); if (isExam(qs)) { exam = pg; frame = fr; questions = qs; break; } } } catch {}
      }
      if (!questions.length) await page.waitForTimeout(3000);
    }
    if (!questions.length) { log('끝내 미도달 — 종료 대기'); await exam.waitForTimeout(40 * 60 * 1000); await browser.close(); return; }
  }
  await exam.bringToFront().catch(() => {});
  log(`시험 문항 도달: ${questions.length}문항 — ${exam.url()}`);

  const parseMap = (raw) => { const m = (raw || '').match(/\{[\s\S]*\}/); if (!m) return {}; try { return JSON.parse(m[0]); } catch { return {}; } };

  // 문항 전문 로그 (Claude 교차검증용)
  const lines = questions.map((q, i) => `${i + 1}. ${q.qtext}\n${q.options.map((o, idx) => `   ${idx + 1}) ${o.text}`).join('\n')}`).join('\n\n');
  log('===== 추출 문항 전문 =====\n' + lines + '\n========================');

  // ── 1차: 텍스트 풀이 × 3회 다수결(self-consistency) ──
  log(`시험 ${questions.length}문항 — 1차(텍스트) 3회 다수결...`);
  const prompt1 = '한국어 산업안전보건 객관식 시험입니다. 각 문항의 정답을 신중히 고르세요. 출력은 JSON {"1":정답보기번호,"2":번호,...} 형식만. 보기번호는 1부터.\n\n' + lines;
  const runs = [];
  for (let k = 0; k < 3; k++) { const rr = parseMap(await gemini([{ text: prompt1 }])); runs.push(rr); log(`1차 run${k + 1}:`, JSON.stringify(rr)); }
  const a1 = {};
  for (let i = 1; i <= questions.length; i++) {
    const votes = {};
    runs.forEach((r) => { const v = r[String(i)]; if (v) votes[v] = (votes[v] || 0) + 1; });
    let best = null; let bc = 0;
    Object.entries(votes).forEach(([v, c]) => { if (c > bc) { bc = c; best = Number(v); } });
    a1[String(i)] = best;
  }
  log('1차 다수결:', JSON.stringify(a1));

  // ── 2차: 스크린샷 비전 풀이 ──
  log('화면 캡처 → 2차(비전) 풀이...');
  let p2raw = null;
  try {
    const shot = await exam.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(__dirname, 'exam_shot.png'), shot);
    p2raw = await gemini([
      { text: '이미지는 한국어 산업안전보건 객관식 시험 화면입니다. 각 문항의 정답을 고르세요. 보기는 위에서부터 1,2,3,4,5번. 출력은 JSON {"1":번호,"2":번호,...} 형식만.' },
      { inline_data: { mime_type: 'image/png', data: shot.toString('base64') } },
    ]);
  } catch (e) { log('2차 캡처/비전 오류:', e.message); }
  const a2 = parseMap(p2raw);
  log('2차(비전):', JSON.stringify(a2));

  // 1차 기준으로 보기 선택(제출 안 함)
  for (let i = 0; i < questions.length; i++) {
    const opt = Number(a1[String(i + 1)]);
    const q = questions[i];
    const idx = (opt >= 1 && opt <= q.options.length) ? opt - 1 : 0;
    await frame.locator(`[data-aqid="${q.options[idx].id}"]`).first().check({ force: true }).catch(() => {});
  }

  // 대조 리포트
  const rows = questions.map((q, i) => {
    const n = String(i + 1);
    const o1 = Number(a1[n]); const o2 = Number(a2[n]);
    const match = o1 && o2 ? (o1 === o2 ? '✅일치' : '⚠️불일치') : '❔';
    const txt1 = q.options[o1 - 1]?.text?.slice(0, 40) || '?';
    return { i: i + 1, o1, o2, match, txt1, qtext: q.qtext.slice(0, 45) };
  });
  const agree = rows.filter((r) => r.match === '✅일치').length;
  const disagree = rows.filter((r) => r.match === '⚠️불일치');

  const body = rows.map((r) => `Q${r.i}. ${r.qtext}\n  1차:${r.o1}번 / 2차:${r.o2}번 ${r.match}  → ${r.txt1}`).join('\n');
  await notify(`총 ${questions.length}문항 · **2차 검증 일치 ${agree}/${questions.length}** · 불일치 ${disagree.length}개. 제출 안 함 — 검토 후 직접 [최종제출](60분 내).`, {
    level: disagree.length ? 'warn' : 'success',
    fields: disagree.length ? [{ name: '⚠️ 불일치(직접 확인 권장)', value: disagree.map((r) => `Q${r.i}: 1차${r.o1}번 vs 2차${r.o2}번`).join('\n').slice(0, 1024) }] : undefined,
  });
  for (let p = 0; p < body.length; p += 1800) await notify(p === 0 ? '문항별 1차/2차 답' : '(계속)', { fields: [{ name: '​', value: body.slice(p, p + 1800) }] });

  log('===== 1차/2차 대조 =====');
  rows.forEach((r) => log(`Q${r.i}: 1차${r.o1} 2차${r.o2} ${r.match}`));
  log(`일치 ${agree}/${questions.length}, 불일치 ${disagree.length}`);
  log('1차 답으로 선택해둠(제출X). 검토 후 직접 제출하세요. (창 55분 유지)');
  await exam.waitForTimeout(55 * 60 * 1000);
  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
