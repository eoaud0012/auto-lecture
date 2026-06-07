// Explore course list + player using saved login state.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: __dirname + '/state.json' });
  const page = await ctx.newPage();
  const shot = (n) => page.screenshot({ path: `${__dirname}/screenshots/${n}.png`, fullPage: true });

  console.log('>> goto my courses');
  await page.goto(cfg.baseUrl + '/mypage/course', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot('03-my-course');
  console.log('URL:', page.url());

  const links = await page.$$eval('a', els =>
    els.map(e => ({ text: e.innerText.trim().slice(0,50), href: e.href }))
       .filter(l => l.href && (l.href.includes('course') || l.href.includes('learn') || l.href.includes('play') || l.href.includes('enrollment') || l.text)));
  console.log('COURSE LINKS:', JSON.stringify(links.slice(0,40), null, 2));

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log('BODY:\n', bodyText);

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
