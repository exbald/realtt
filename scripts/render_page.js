const { chromium } = require('/app/generations/realtt/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'better-auth.session_token',
    value: 'm3Kob87AML8fPDaiRIk6TNW7xmCmGEbF',
    domain: 'localhost',
    path: '/'
  }]);
  const page = await context.newPage();
  await page.goto('http://localhost:3001/session/fe3199e3-0d35-4e52-965f-bbcbf62f176d', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const content = await page.content();
  require('fs').writeFileSync('/tmp/rendered_page.html', content);
  await page.screenshot({ path: '/tmp/session_screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/session_screenshot.png');
  await browser.close();
})();
