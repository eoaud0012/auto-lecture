// Enter the classroom (나의 강의실) and inspect player + progress network calls.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();
  const shot = (n) => page.screenshot({ path: `${__dirname}/screenshots/${n}.png`, fullPage: true });

  // log network: progress-ish API calls
  page.on('request', req => {
    const u = req.url();
    if (/progress|learn|study|clip|player|lesson|course|complete|heartbeat|log|api/i.test(u) && !/\.(png|jpg|css|js|woff|svg|gif)/i.test(u)) {
      console.log('REQ', req.method(), u);
    }
  });

  await page.goto(cfg.baseUrl + '/mypage/course', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // click the first 나의 강의실
  const enter = page.locator('text=나의 강의실').first();
  console.log('clicking 나의 강의실 ...');
  const [popup] = await Promise.all([
    page.waitForEvent('popup').catch(() => null),
    enter.click().catch(e => console.log('click err', e.message)),
  ]);
  const target = popup || page;
  await target.waitForLoadState('networkidle').catch(()=>{});
  await target.waitForTimeout(3000);
  console.log('CLASSROOM URL:', target.url());
  await target.screenshot({ path: `${__dirname}/screenshots/04-classroom.png`, fullPage: true });

  // dump curriculum list (clips)
  const clips = await target.$$eval('a,li,button', els =>
    els.map(e => (e.innerText||'').trim()).filter(t => t && t.length < 60).slice(0,80));
  console.log('CLIPS/ITEMS:', JSON.stringify(clips, null, 1));

  // any video element?
  const vids = await target.$$eval('video', els => els.map(v => ({ src: v.currentSrc||v.src, dur: v.duration })));
  console.log('VIDEOS:', JSON.stringify(vids));
  const iframes = await target.$$eval('iframe', els => els.map(f => f.src));
  console.log('IFRAMES:', JSON.stringify(iframes));

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
