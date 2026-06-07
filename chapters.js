// Fetch chapter list for a course to understand structure (legit enumeration only).
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();

  await page.goto(cfg.baseUrl + '/course/27918?productId=21159&tab=info', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  const [popup] = await Promise.all([ page.waitForEvent('popup').catch(()=>null), btn.click({force:true}).catch(()=>{}) ]);
  const modu = popup || page;
  await modu.waitForLoadState('networkidle').catch(()=>{});
  await modu.waitForTimeout(2500);
  await modu.locator('text=수강하기').locator('visible=true').first().click({force:true}).catch(()=>{});
  await modu.waitForTimeout(5000);
  const player = ctx.pages().find(p=>/studyView/.test(p.url())) || modu;
  const m = player.url().match(/contentsCode=(\w+).*lectureOpenSeq=(\d+)/);
  console.log('player url:', player.url());
  if (m) {
    const r = await player.request.get(`https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=${m[1]}&lectureOpenSeq=${m[2]}`);
    console.log('CHAPTERS JSON:\n', (await r.text()).slice(0, 3000));
  }
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
