// 서버용: 헤드리스 Chrome으로 벤치 페이지를 열고 끝날 때까지 기다린다.
// 사용: node bench_run.js <url> <완료 문자열> [timeout 분]
const puppeteer = require('puppeteer-core');
(async () => {
  const [, , url, doneText, mins = '120'] = process.argv;
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(url, { timeout: 120000 });
  const end = Date.now() + mins * 60000;
  while (Date.now() < end) {
    const t = await p.evaluate(() => document.getElementById('log').textContent).catch(() => '');
    if (t.includes(doneText)) { console.log('OK', doneText); break; }
    await new Promise(r => setTimeout(r, 5000));
  }
  await b.close();
})();
