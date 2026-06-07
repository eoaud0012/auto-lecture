// Click 수강하기 -> chapter list / player. Capture progress-save API.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();

  const reqs = [];
  ctx.on('request', req => {
    const u = req.url();
    if (/modulearning/i.test(u) && /\.php/i.test(u) && !/css|js|header|footer/i.test(u)) {
      reqs.push(`${req.method()} ${u}${req.method()!=='GET'?' | '+(req.postData()||'').slice(0,250):''}`);
    }
  });
  const pages = [];
  ctx.on('page', pg => pages.push(pg));

  // reach modu study center
  await page.goto(cfg.baseUrl + '/course/27918?productId=21159&tab=info', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  const [popup] = await Promise.all([ page.waitForEvent('popup').catch(()=>null), btn.click({force:true}).catch(()=>{}) ]);
  const modu = popup || page;
  await modu.waitForLoadState('networkidle').catch(()=>{});
  await modu.waitForTimeout(3000);

  reqs.length = 0;
  console.log('clicking 수강하기 ...');
  const [popup2] = await Promise.all([
    ctx.waitForEvent('page').catch(()=>null),
    modu.locator('text=수강하기').locator('visible=true').first().click({force:true}).catch(e=>console.log('clickerr',e.message)),
  ]);
  await modu.waitForTimeout(4000);
  const player = popup2 || modu;
  await player.waitForLoadState('networkidle').catch(()=>{});
  await player.waitForTimeout(3000);
  console.log('PLAYER URL:', player.url());
  await player.screenshot({ path: `${__dirname}/screenshots/07-chapters.png`, fullPage: true });

  for (const f of player.frames()) {
    try {
      const t = await f.evaluate(() => document.body && document.body.innerText.slice(0,1000));
      if (t && t.trim()) console.log(`\n[FRAME ${f.url().slice(0,70)}]\n${t}`);
      const vids = await f.$$eval('video', els => els.map(v=>({src:(v.currentSrc||v.src||'').slice(0,90),dur:v.duration,paused:v.paused})));
      if (vids.length) console.log('  VIDEOS:', JSON.stringify(vids));
    } catch(e){}
  }
  console.log('\nALL PAGES:', ctx.pages().map(p=>p.url()));
  console.log('\n=== REQ LOG (수강하기 이후) ===');
  console.log(reqs.join('\n'));

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
