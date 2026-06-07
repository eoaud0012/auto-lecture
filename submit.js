// 최종평가 답안 선택 + 최종제출 (검증된 답안 하드코딩)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '.env.json'), 'utf8'));
const STATE = path.join(__dirname, 'state.json');
const COURSE = { courseId: '27918', productId: '21159' };
const log = (...a) => console.log(new Date().toLocaleTimeString('ko-KR'), ...a);

// 최종 검증 답안 (문항번호: 보기번호, 1-based)
const ANSWERS = { 1: 1, 2: 3, 3: 1, 4: 4, 5: 4, 6: 4, 7: 4, 8: 1, 9: 2, 10: 2, 11: 2, 12: 4 };

async function notify(msg, level = 'info') {
  const colors = { info: 0x5865f2, success: 0x2ecc71, warn: 0xe67e22, error: 0xe74c3c };
  try {
    if (cfg.discordToken && cfg.discordChannelId) {
      await fetch(`https://discord.com/api/v10/channels/${cfg.discordChannelId}/messages`, {
        method: 'POST', headers: { Authorization: `Bot ${cfg.discordToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [{ title: '📝 최종평가 제출', description: msg, color: colors[level], timestamp: new Date().toISOString() }] }),
      });
    }
  } catch {}
}

const EXTRACT = () => {
  let cnt = 0;
  const groups = []; const byName = {};
  document.querySelectorAll('input[type="radio"]').forEach((r) => {
    const name = r.name || `__r${cnt++}`;
    if (!byName[name]) { byName[name] = []; groups.push({ name, inputs: byName[name] }); }
    byName[name].push(r);
  });
  // 각 그룹의 보기에 data-aqid 부여, 텍스트도 반환
  return groups.map((g) => g.inputs.map((inp) => {
    const id = `sq${cnt++}`; inp.setAttribute('data-aqid', id);
    const lbl = (inp.closest('label')?.innerText || inp.closest('li,tr,td,p,div')?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return { id, text: lbl };
  }));
};

const isExam = (qs) => qs.length >= 2 && !qs.some((opts) => opts.some((o) => /그렇다|매우 만족|보통이다/.test(o.text))) && !qs.every((opts) => opts.some((o) => /숙지|동의|공정/.test(o.text)));

async function findQuizFrame(page) {
  try { if (await page.$('input[type="radio"]')) return page.mainFrame(); } catch {}
  for (const f of page.frames()) { try { if (await f.$('input[type="radio"]')) return f; } catch {} }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 35, args: ['--start-maximized', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: null, storageState: fs.existsSync(STATE) ? STATE : undefined });
  ctx.on('page', (p) => p.on('dialog', (d) => { log('팝업:', d.message().slice(0, 80)); d.accept().catch(() => {}); }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => { log('팝업:', d.message().slice(0, 80)); d.accept().catch(() => {}); });

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

  log('최종평가 재진입...');
  // 최종평가 진입 시도(여러 방식) — 반복 호출 가능
  const clickFinal = async () => {
    for (const sel of ["[onclick*=\"openTest('final'\"]", 'text=최종평가', 'text=응시중', 'text=이어서 응시', 'text=이어보기']) {
      try { const b = modu.locator(sel).locator('visible=true').first(); if (await b.isVisible({ timeout: 800 }).catch(() => false)) { await b.click({ force: true }).catch(() => {}); return; } } catch {}
    }
    await modu.evaluate(() => { try { openTest('final', '5066390', 'WCD7NL', '93030', 5); } catch (e) {} }).catch(() => {});
  };

  const passAgreement = async (pg) => {
    try {
      const isCaution = await pg.evaluate(() => /숙지하였으며|공정하게 평가|주의사항/.test(document.body?.innerText || '')).catch(() => false);
      if (!isCaution) return;
      await pg.locator('[onclick*="clickCheckbox"], :text("위 사항을 모두 숙지")').locator('visible=true').first().click({ force: true }).catch(() => {});
      await pg.evaluate(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }); }).catch(() => {});
      await pg.waitForTimeout(400);
      await pg.locator('text=평가보기, [onclick*="agreeCaution"]').locator('visible=true').first().click({ force: true }).catch(() => {});
      await pg.waitForTimeout(2500);
    } catch {}
  };

  await clickFinal();
  await page.waitForTimeout(4000);

  // 최대 ~5분 폴링: 자동 진입 재시도 + 동의 통과 + 사용자 수동 클릭도 캐치
  let exam = null; let frame = null; let questions = [];
  for (let t = 0; t < 100 && !questions.length; t++) {
    for (const pg of ctx.pages()) {
      try {
        if (pg.isClosed()) continue;
        await passAgreement(pg);
        const fr = await findQuizFrame(pg);
        if (fr) { const qs = await fr.evaluate(EXTRACT); if (isExam(qs)) { exam = pg; frame = fr; questions = qs; break; } }
      } catch {}
    }
    if (!questions.length) {
      if (t % 5 === 0) { log(`문항 탐색 중... (${t * 3}s) — 자동이 안 되면 화면에서 '최종평가' 버튼을 눌러주세요`); await clickFinal().catch(() => {}); }
      await page.waitForTimeout(3000);
    }
  }
  if (!questions.length) { log('문항 미도달 — 중단(제출 안 함).'); await notify('제출 스크립트: 문항 미도달 — 제출 안 함.', 'warn'); await page.waitForTimeout(20 * 60 * 1000); await browser.close(); return; }
  await exam.bringToFront().catch(() => {});
  log(`문항 ${questions.length}개 도달 — 답안 선택 시작`);

  // 답안 선택 — 사이트가 선택 시마다 재렌더하므로 한 문항씩 순차 + 매번 재조회 + 재렌더 대기
  const selectOne = async (qi, oi) => frame.evaluate(({ qi, oi }) => {
    const groups = []; const byName = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => { const n = r.name || ('__' + groups.length); if (!byName[n]) { byName[n] = []; groups.push(byName[n]); } byName[n].push(r); });
    const g = groups[qi]; if (!g || !g[oi - 1]) return false;
    const inp = g[oi - 1];
    inp.checked = true;
    inp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    const lbl = (inp.id && document.querySelector(`label[for="${inp.id}"]`)) || inp.closest('label');
    if (lbl && lbl !== inp) { try { lbl.click(); } catch (e) {} }
    return true;
  }, { qi, oi }).catch(() => false);

  for (let i = 0; i < questions.length; i++) {
    await selectOne(i, ANSWERS[i + 1]);
    await page.waitForTimeout(450); // 재렌더 대기
  }
  // 누락분 한 번 더 보강
  await page.waitForTimeout(500);
  let picks = await frame.evaluate(() => {
    const groups = []; const byName = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => { const n = r.name || ('__' + groups.length); if (!byName[n]) { byName[n] = []; groups.push(byName[n]); } byName[n].push(r); });
    return groups.map((g) => g.findIndex((r) => r.checked) + 1);
  }).catch(() => []);
  for (let i = 0; i < questions.length; i++) { if (picks[i] !== ANSWERS[i + 1]) { await selectOne(i, ANSWERS[i + 1]); await page.waitForTimeout(450); } }
  picks = await frame.evaluate(() => {
    const groups = []; const byName = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => { const n = r.name || ('__' + groups.length); if (!byName[n]) { byName[n] = []; groups.push(byName[n]); } byName[n].push(r); });
    return groups.map((g) => g.findIndex((r) => r.checked) + 1);
  }).catch(() => []);
  const checkedCount = picks.filter((p) => p > 0).length;
  log(`체크됨 ${checkedCount}/${questions.length} | 선택보기 ${JSON.stringify(picks)}`);
  if (checkedCount < questions.length) {
    log('⚠️ 체크 반영 부족 — 제출 중단(안전).');
    await notify(`자동 체크 반영 부족(${checkedCount}/${questions.length}) — 제출 안 함.`, 'warn');
    await page.waitForTimeout(20 * 60 * 1000); await browser.close(); return;
  }

  // 최종 제출
  log('최종제출 클릭...');
  const submitBtn = exam.locator('text=최종제출, text=제출하기, button:has-text("제출"), input[value*="제출"]').locator('visible=true').first();
  await submitBtn.click({ force: true }).catch(async () => {
    await exam.locator('button:has-text("제출"), a:has-text("제출")').first().click({ force: true }).catch(() => {});
  });
  await page.waitForTimeout(6000);

  // 결과 확인
  const after = await exam.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300)).catch(() => '');
  log('제출 후 화면(앞부분):', after);
  // API 로 testStatus/score 확인
  try {
    const sv = ctx.pages().find((p) => /studyView/.test(p.url()));
    let api = null;
    for (const pg of ctx.pages()) {
      const u = pg.url(); const m = u.match(/contentsCode=(\w+).*?lectureOpenSeq=(\d+).*?studySeq=(\d+)/);
      if (m) { api = `https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=${m[1]}&lectureOpenSeq=${m[2]}&studySeq=${m[3]}`; break; }
    }
    if (!api) api = `https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=WCD7NL&lectureOpenSeq=93030&studySeq=5066390`;
    const r = await (sv || exam || page).request.get(api);
    const j = await r.json();
    log('API:', JSON.stringify({ testStatus: j.testStatus, testScore: j.testScore, certPass: j.certPass, totalProgress: j.totalProgress }));
    await notify(`최종평가 제출 완료 시도. testStatus=${j.testStatus}, 점수=${j.testScore ?? '집계중'}, certPass=${j.certPass}`, 'success');
  } catch (e) { log('API 확인 오류:', e.message); }

  log('제출 처리 완료. 화면에서 결과 확인하세요. (창 유지)');
  await page.waitForTimeout(30 * 60 * 1000);
  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
