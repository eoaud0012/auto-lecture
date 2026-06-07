// Reach player, fetch chapter list, test playbackRate + seeking + whether progress is honored.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();

  const prog = [];
  ctx.on('response', async resp => {
    const u = resp.url();
    if (/apiProgress\.php/.test(u)) {
      let body=''; try { body = (await resp.text()).slice(0,200); } catch{}
      prog.push(`<- ${resp.status()} ${body.replace(/\s+/g,' ')}`);
    }
  });

  // flow to player
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
  console.log('PLAYER URL:', player.url());

  // chapter list via authenticated request
  const m = player.url().match(/contentsCode=(\w+).*lectureOpenSeq=(\d+)/);
  if (m) {
    const r = await player.request.get(`https://fast.modulearning.kr/api/apiStudyChapter.php?contentsCode=${m[1]}&lectureOpenSeq=${m[2]}`);
    const txt = await r.text();
    console.log('\n=== CHAPTER LIST ===\n', txt.slice(0, 2500));
  }

  // find the player frame with video
  let vf = null;
  for (const f of player.frames()) { if (await f.$('video')) { vf = f; break; } }
  vf = vf || player.mainFrame();

  const before = await vf.$eval('video', v => ({cur:v.currentTime, dur:v.duration, rate:v.playbackRate}));
  console.log('\nVIDEO before:', JSON.stringify(before));

  // test 1: bump playbackRate
  await vf.$eval('video', v => { v.muted=true; v.playbackRate = 16; v.play&&v.play(); });
  await player.waitForTimeout(6000);
  const afterRate = await vf.$eval('video', v => ({cur:v.currentTime, rate:v.playbackRate}));
  console.log('after rate=16 for 6s:', JSON.stringify(afterRate), '(currentTime delta shows if speed honored)');

  // test 2: seek near end
  await vf.$eval('video', v => { v.currentTime = Math.max(0, (v.duration||100) - 20); });
  await player.waitForTimeout(4000);
  const afterSeek = await vf.$eval('video', v => ({cur:v.currentTime, dur:v.duration}));
  console.log('after seek to dur-20:', JSON.stringify(afterSeek), '(if cur snaps back, seeking is blocked)');

  console.log('\n=== apiProgress responses ===');
  console.log(prog.slice(-8).join('\n'));

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
