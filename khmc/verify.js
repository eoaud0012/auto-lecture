// 경희의료원 사이버연수원 수료 검증 — 과정목록 4개(법정·인증·직원공통·특성화)의 모든 행이 (수료완료)+수료증 링크인지 확인.
// 사용: node khmc/verify.js <사번> [사번...]   (PW 기본=사번). 인자 없으면 khmc/.env.accounts.json 명부 전체.
// 조회만 함 — 단, 같은 계정의 진행 중 세션은 중복로그인으로 끊기니 수강 종료 후 실행.
// 목록 페이지 전체 스크린샷 → khmc/screenshots/<사번>-<구분>.png. 미수료가 하나라도 있으면 exit 1.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://khmc.migaedu.com';
const LISTS = { 법정: '010001', 인증: '010002', 직원공통: '010004', 특성화: '010003' };
const SHOTS = path.join(__dirname, 'screenshots');
// 계정 명부(git 제외): [{ alias, id, name, ... }] — 공개 저장소라 실명·사번은 이 파일에만 둔다
const roster = (() => { try { return require('./.env.accounts.json'); } catch { return []; } })();
const ids = process.argv.length > 2 ? process.argv.slice(2) : roster.map(a => a.id);

async function verify(browser, id) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ctx.on('page', p => p.on('dialog', d => d.dismiss().catch(() => {})));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/Main/Index.nm`, { waitUntil: 'domcontentloaded' });
  await page.fill('#outMdID', id);
  await page.fill('#outMdPW', process.env.PW || id);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('#outLogin input[type=submit]')]);
  await page.waitForTimeout(2500);
  if (await page.$('#outMdID')) { await ctx.close(); return { id, login: false }; }
  const name = await page.evaluate(() => (document.body.innerText.match(/(\S+)님 반갑습니다/) || [])[1] || '');

  const res = { id, name, login: true, groups: {}, notDone: [] };
  for (const [g, cc] of Object.entries(LISTS)) {
    await page.goto(`${BASE}/Study/Index/ccCode/${cc}.nm`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr')].map(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 5) return null;
      const t = tr.innerText;
      return {
        name: tds[1].innerText.split('\n')[0].trim(),
        st: (t.match(/수료완료|수강중|미수료|미신청/) || [])[0] || '?',
        cert: [...tr.querySelectorAll('a')].some(a => a.innerText.includes('수료증')),
      };
    }).filter(r => r && r.name));
    await page.screenshot({ path: path.join(SHOTS, `${id}-${g}.png`), fullPage: true });
    const ok = rows.filter(r => r.st === '수료완료' && r.cert).length;
    res.groups[g] = `${ok}/${rows.length}`;
    rows.filter(r => !(r.st === '수료완료' && r.cert)).forEach(r => res.notDone.push(`[${g}] ${r.name} — ${r.st}${r.cert ? '' : ', 수료증 없음'}`));
    if (rows.length === 0) res.notDone.push(`[${g}] 목록 읽기 실패(0행)`);
  }
  await ctx.close();
  return res;
}

(async () => {
  if (!ids.length) { console.log('사용: node khmc/verify.js <사번> [사번...]  (또는 khmc/.env.accounts.json 작성)'); process.exit(2); }
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let allOk = true;
  for (const id of ids) {
    const r = await verify(browser, id).catch(e => ({ id, error: e.message }));
    if (!r.login || r.error) { allOk = false; console.log(`❌ ${id} ${r.error || '로그인 실패'}`); continue; }
    const ok = r.notDone.length === 0;
    allOk &&= ok;
    console.log(`${ok ? '✅' : '❌'} ${id} ${r.name}  ` + Object.entries(r.groups).map(([g, v]) => `${g} ${v}`).join(' · '));
    r.notDone.forEach(x => console.log(`     ${x}`));
  }
  await browser.close();
  process.exit(allOk ? 0 : 1);
})();
