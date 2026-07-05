const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)); });

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'manager@srms.app');
  await page.fill('#password', 'Password123!');
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 }).catch(() => {});

  await page.goto('http://localhost:3000/admin/staff', { waitUntil: 'networkidle' });
  await page.click('text=Invite via Email');
  await page.waitForTimeout(300);

  await page.fill('input[type=email]', 'siddantasodari123@gmail.com');
  // Select role = waiter (id 4) is already default; leave as-is.
  await page.click('button:has-text("Send Invite")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/claude-1000/-home-mac-KKKhane/5530db1b-c8e6-4091-b403-a61cb8ec3c9b/scratchpad/06-after-invite.png', fullPage: true });

  const bodyText = await page.textContent('body');
  console.log('Contains invited email in list:', bodyText.includes('siddantasodari123@gmail.com'));
  console.log('Console errors:', JSON.stringify(errors, null, 2));

  await browser.close();
})();
