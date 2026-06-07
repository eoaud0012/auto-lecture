// Login + explore the skillflo site structure (headless). Two-step login.
const { chromium } = require('playwright');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/.env.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  fs.mkdirSync(__dirname + '/screenshots', { recursive: true });
  const shot = (n) => page.screenshot({ path: `${__dirname}/screenshots/${n}.png`, fullPage: true });

  console.log('>> goto signin');
  await page.goto(cfg.baseUrl + '/auth/signin', { waitUntil: 'networkidle' });

  // step 1: username
  await page.fill('input[name="username"]', cfg.userId);
  await page.click('button:has-text("계속하기")');
  await page.waitForTimeout(1500);
  await shot('01b-after-username');

  // step 2: password (now visible)
  const pw = page.locator('input[type="password"]:visible').first();
  await pw.fill(cfg.password);
  await page.waitForTimeout(300);
  // click submit (계속하기 / 로그인)
  const submit = page.locator('button:has-text("계속하기"), button:has-text("로그인")').first();
  await submit.click();
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(2500);
  console.log('>> after login URL:', page.url());
  await shot('02-after-login');

  const links = await page.$$eval('a', els =>
    els.map(e => ({ text: e.innerText.trim().slice(0, 40), href: e.href }))
       .filter(l => l.text && l.href));
  console.log('LINKS:', JSON.stringify(links.slice(0, 60), null, 2));

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log('BODYTEXT:\n', bodyText);

  // save storage state for reuse
  await ctx.storageState({ path: __dirname + '/state.json' });
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
