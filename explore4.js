// Open the actual player (강의 보기) and capture video + progress/heartbeat API.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();

  const reqLog = [];
  page.on('request', req => {
    const u = req.url();
    if (/skillflo\.io\/api/.test(u) && /progress|clip|lesson|study|learn|complete|heartbeat|play|position|log|enroll/i.test(u)) {
      reqLog.push(`${req.method()} ${u} ${req.method()!=='GET' ? '\n   BODY: '+(req.postData()||'').slice(0,300) : ''}`);
    }
  });

  // go to safety course player directly
  await page.goto(cfg.baseUrl + '/course/27918?productId=21159&tab=info', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('clicking 강의 보기 ...');
  const btn = page.locator('text=강의 보기').locator('visible=true').first();
  await btn.scrollIntoViewIfNeeded().catch(()=>{});
  const [popup] = await Promise.all([
    page.waitForEvent('popup').catch(()=>null),
    btn.click({ force: true }).catch(e=>console.log('err',e.message)),
  ]);
  const p = popup || page;
  await p.waitForLoadState('networkidle').catch(()=>{});
  await p.waitForTimeout(5000);
  console.log('PLAYER URL:', p.url());
  await p.screenshot({ path: `${__dirname}/screenshots/05-player.png`, fullPage: true });

  // video info
  const vids = await p.$$eval('video', els => els.map(v => ({ src:(v.currentSrc||v.src||'').slice(0,80), dur:v.duration, cur:v.currentTime, paused:v.paused })));
  console.log('VIDEOS:', JSON.stringify(vids));
  const iframes = await p.$$eval('iframe', els => els.map(f=>f.src));
  console.log('IFRAMES:', JSON.stringify(iframes));

  // try to play and watch for progress calls for ~15s
  reqLog.length = 0;
  await p.evaluate(() => { const v=document.querySelector('video'); if(v){ v.muted=true; v.play&&v.play(); } });
  await p.waitForTimeout(15000);
  const v2 = await p.$$eval('video', els => els.map(v=>({cur:v.currentTime, dur:v.duration, paused:v.paused, rate:v.playbackRate})));
  console.log('VIDEO after 15s:', JSON.stringify(v2));
  console.log('PROGRESS API CALLS during playback:');
  console.log(reqLog.join('\n') || '(none captured)');

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
