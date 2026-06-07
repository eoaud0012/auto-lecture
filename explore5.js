// Explore modulearning player domain: capture all requests, frames, page content.
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
    if (/modulearning|mylight/i.test(u) && !/\.(png|jpg|jpeg|css|woff2?|svg|gif|ico)/i.test(u)) {
      reqs.push(`${req.method()} ${u}${req.method()!=='GET'?' | '+(req.postData()||'').slice(0,200):''}`);
    }
  });

  await page.goto(cfg.baseUrl + '/course/27918?productId=21159&tab=info', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  const [popup] = await Promise.all([
    page.waitForEvent('popup').catch(()=>null),
    btn.click({ force: true }).catch(()=>{}),
  ]);
  const p = popup || page;
  await p.waitForLoadState('networkidle').catch(()=>{});
  await p.waitForTimeout(4000);
  console.log('PLAYER URL:', p.url());
  await p.screenshot({ path: `${__dirname}/screenshots/06-modu.png`, fullPage: true });

  // frames
  console.log('FRAMES:');
  for (const f of p.frames()) console.log('  -', f.url());

  // body text of main + each frame
  for (const f of p.frames()) {
    try {
      const t = await f.evaluate(() => document.body && document.body.innerText.slice(0,800));
      if (t && t.trim()) console.log(`\n[FRAME ${f.url().slice(0,70)}]\n${t}`);
      const vids = await f.$$eval('video', els => els.map(v=>({src:(v.currentSrc||v.src||'').slice(0,90),dur:v.duration})));
      if (vids.length) console.log('  VIDEOS:', JSON.stringify(vids));
      const links = await f.$$eval('a,button', els => els.map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length<50).slice(0,40));
      if (links.length) console.log('  ITEMS:', JSON.stringify(links));
    } catch(e) {}
  }

  console.log('\n=== MODU/REQ LOG ===');
  console.log(reqs.join('\n'));

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
