const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  const reqFails = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 400)); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + String(err)));
  page.on('requestfailed', req => reqFails.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`));

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'newuser@srms.app');
  await page.fill('#password', 'Password123!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding/**', { timeout: 15000 }).catch(() => {});
  console.log('URL after login:', page.url());

  if (!page.url().includes('/onboarding/create')) {
    await page.goto('http://localhost:3000/onboarding/create', { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1500);
  console.log('URL now:', page.url());

  await page.click('button[title="Pin on Map"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/claude-1000/-home-mac-KKKhane/5530db1b-c8e6-4091-b403-a61cb8ec3c9b/scratchpad/map-01.png', fullPage: true });

  // Inspect the map container's actual rendered size + tile img count
  const mapInfo = await page.evaluate(() => {
    const el = document.querySelector('.leaflet-container');
    const tiles = document.querySelectorAll('.leaflet-tile');
    const loadedTiles = document.querySelectorAll('.leaflet-tile-loaded');
    return {
      hasLeafletContainer: !!el,
      rect: el ? el.getBoundingClientRect() : null,
      tileCount: tiles.length,
      loadedTileCount: loadedTiles.length,
    };
  });
  console.log('Map info:', JSON.stringify(mapInfo, null, 2));
  console.log('Console errors:', JSON.stringify(errors, null, 2));
  console.log('Failed requests:', JSON.stringify(reqFails, null, 2));

  await browser.close();
})();
