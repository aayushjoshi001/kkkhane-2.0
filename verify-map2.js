const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 250)); });

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'newuser@srms.app');
  await page.fill('#password', 'Password123!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding/**', { timeout: 15000 }).catch(() => {});
  if (!page.url().includes('/onboarding/create')) {
    await page.goto('http://localhost:3000/onboarding/create', { waitUntil: 'networkidle' });
  }
  await page.click('button[title="Pin on Map"]');
  await page.waitForTimeout(2000);

  // Click roughly in the center of the map to set a position -> triggers marker + reverse geocode
  const mapEl = await page.$('.leaflet-container');
  const box = await mapEl.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(3000);

  const markerInfo = await page.evaluate(() => {
    const marker = document.querySelector('.leaflet-marker-icon');
    return { hasMarker: !!marker, markerSrc: marker ? marker.getAttribute('src') : null };
  });
  console.log('Marker info:', JSON.stringify(markerInfo));

  const cspErrors = errors.filter(e => e.includes('Content Security Policy'));
  console.log('Total CSP errors:', cspErrors.length);
  console.log('Unique blocked domains:', [...new Set(cspErrors.map(e => { const m = e.match(/'([^']+)'/g); return m ? m[0] : e; }))]);
  console.log('Sample non-tile CSP errors:', JSON.stringify(cspErrors.filter(e => !e.includes('tile.openstreetmap')), null, 2));

  await browser.close();
})();
