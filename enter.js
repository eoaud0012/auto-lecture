// 최종평가 "주의사항/동의" 화면까지만 진입 (동의 체크/평가보기 누르지 않음 = 시험 미시작)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '.env.json'), 'utf8'));
const STATE = path.join(__dirname, 'state.json');
const COURSE = { courseId: '27918', productId: '21159' };
const log = (...a) => console.log(new Date().toLocaleTimeString('ko-KR'), ...a);

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40, args: ['--start-maximized', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: null, storageState: fs.existsSync(STATE) ? STATE : undefined });
  // 확인창은 통과(accept) — 사용자가 '평가보기' 누를 때 확인창이 취소되지 않도록
  ctx.on('page', (p) => p.on('dialog', (d) => { log('팝업:', d.message().slice(0, 70)); d.accept().catch(() => {}); }));
  const page = await ctx.newPage();
  page.on('dialog', (d) => { log('팝업:', d.message().slice(0, 70)); d.accept().catch(() => {}); });

  // 로그인
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

  // 스터디센터 진입
  await page.goto(`${cfg.baseUrl}/course/${COURSE.courseId}?productId=${COURSE.productId}&tab=info`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const [pop] = await Promise.all([page.waitForEvent('popup').catch(() => null), btn.click({ force: true }).catch(() => {})]);
  const modu = pop || page;
  await modu.waitForLoadState('networkidle').catch(() => {});
  await modu.waitForTimeout(3500);
  await modu.bringToFront().catch(() => {});
  log('스터디센터:', modu.url());

  // 최종평가 버튼 실제 클릭 → 주의사항 화면
  log('최종평가 클릭(주의사항 화면까지만)...');
  let popup = null;
  const finalBtn = modu.locator("[onclick*=\"openTest('final'\"], [onclick*='openTest(\"final\"']").first();
  try {
    [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 12000 }).catch(() => null),
      finalBtn.click({ force: true, timeout: 8000 }),
    ]);
  } catch (e) {
    log('직접 클릭 실패, evaluate 폴백:', e.message);
    await modu.evaluate(() => { try { openTest('final', '5066390', 'WCD7NL', '93030', 5); } catch (er) {} }).catch(() => {});
  }
  const target = popup || modu;
  await target.waitForLoadState('networkidle').catch(() => {});
  await target.waitForTimeout(2500);
  await target.bringToFront().catch(() => {});

  const body = await target.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 200)).catch(() => '');
  log('현재 화면 URL:', target.url());
  log('화면 내용(앞부분):', body);
  const onCaution = /주의사항|숙지하였으며|공정하게 평가/.test(body);
  if (onCaution) {
    // 동의 체크박스를 미리 켜둠 (이것만으론 시험 시작 안 됨 — '평가보기' 눌러야 시작)
    const agree = target.locator('[onclick*="clickCheckbox"], :text("위 사항을 모두 숙지")').locator('visible=true').first();
    await agree.click({ force: true }).catch(() => {});
    await target.evaluate(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }); }).catch(() => {});
    log('✅ 주의사항/동의 화면 도달 + 동의 체크 완료. 화면에서 "평가보기"만 누르면 시험이 시작됩니다(타이머 ON). 문항 뜨면 캡처해서 보내주세요.');
  } else {
    log('⚠️ 주의사항 화면이 아닐 수 있음 — 화면 확인. (스터디센터에서 최종평가 버튼을 직접 눌러도 됨)');
  }

  // 창 유지(동의/평가보기는 사용자가 직접). 닫지 않음.
  await target.waitForTimeout(40 * 60 * 1000);
  await browser.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
