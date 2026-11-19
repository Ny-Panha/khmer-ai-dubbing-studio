const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGE ERROR:', err.stack || err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });
  await page.goto('http://localhost:5173/studio', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const alertText = await page.evaluate(() => {
    const alert = document.querySelector('.top-suite-col-center [role="alert"]');
    return alert ? alert.innerText : 'NO_ALERT';
  });
  console.log('ALERT TEXT:', alertText);
  await browser.close();
})();
