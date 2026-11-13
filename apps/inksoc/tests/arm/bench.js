// Runs the 7-Zip benchmark (4 cores) on an InkSoC page in headless Chromium and prints the result lines.
// usage: node bench.js <page url>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(process.argv[2]);
  await p.waitForSelector('#exec7z:not([disabled])', { timeout: 60000 });
  await p.selectOption('#cores', '4'); await p.click('#exec7z');
  await p.waitForFunction(() => /Finished|Stopped|rror/.test(document.getElementById('exec-out').textContent), null, { timeout: 600000 });
  const t = await p.textContent('#exec-out');
  console.log((t.match(/18:.*|Tot:.*/g) || [t.slice(-400)]).join(' / '), '|', ((await p.textContent('#exec-stats')).match(/Threads.*?switches\)/) || [''])[0]);
  await b.close();
})();
