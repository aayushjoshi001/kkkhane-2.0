const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('dicebear')) console.log('ERR:', msg.text().slice(0,300)); });

  const token = 'fd53af89672189ce80f1c08db8faab635715f36f3363478726e5265b65ba3373';
  await page.goto(`http://localhost:3000/invite/${token}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/claude-1000/-home-mac-KKKhane/5530db1b-c8e6-4091-b403-a61cb8ec3c9b/scratchpad/08-invite-page.png' });

  const bodyText = await page.textContent('body');
  console.log('Shows restaurant name:', bodyText.includes('The House Cafe'));
  console.log('Shows role Waiter:', bodyText.includes('Waiter'));

  await page.fill('#fullName', 'Test Invited Waiter');
  await page.fill('#password', 'TestPassword123!');
  await page.fill('#confirmPassword', 'TestPassword123!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/waiter', { timeout: 15000 }).catch(() => {});
  console.log('URL after accept:', page.url());
  await page.screenshot({ path: '/tmp/claude-1000/-home-mac-KKKhane/5530db1b-c8e6-4091-b403-a61cb8ec3c9b/scratchpad/09-after-accept.png' });

  await browser.close();
})();
