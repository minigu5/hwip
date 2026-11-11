// 합성 학습 이미지 렌더러 — KaTeX/MathJax를 헤드리스 Chrome에서 그려 PNG로 저장한다.
// 입력: JSONL {id, tex}  출력: <out>/<id>.png + <out>/labels.jsonl {id, tex, engine, theme}
// 사용: node render.js in.jsonl outDir [workers]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const [, , IN, OUT_ARG, WORKERS = '12'] = process.argv;
const OUT = path.resolve(OUT_ARG);
fs.mkdirSync(OUT, { recursive: true });
const items = fs.readFileSync(IN, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const done = new Set();
const LABELS = path.join(OUT, 'labels.jsonl');
if (fs.existsSync(LABELS)) for (const l of fs.readFileSync(LABELS, 'utf8').trim().split('\n')) if (l) done.add(JSON.parse(l).id);
const todo = items.filter(it => !done.has(it.id));
const labelOut = fs.createWriteStream(LABELS, { flags: 'a' });

const NM = path.join(__dirname, 'node_modules');
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${NM}/katex/dist/katex.min.css">
<script src="file://${NM}/katex/dist/katex.min.js"></script>
<script>window.MathJax={svg:{fontCache:'none'},startup:{typeset:false}};</script>
<script src="file://${NM}/mathjax-full/es5/tex-svg-full.js"></script>
<style>body{margin:0}#box{display:inline-block}</style></head><body><div id="box"></div></body></html>`;
fs.writeFileSync(path.join(OUT, '..', '_render.html'), PAGE);

// AI 챗봇·문서 화면에서 흔한 색 조합
const LIGHT = [['#0d0d0d', '#ffffff'], ['#1f1f1f', '#ffffff'], ['#000000', '#ffffff'], ['#374151', '#f7f7f8'],
  ['#1a1a1a', '#faf9f5'], ['#202124', '#f0f4f9'], ['#24292f', '#f6f8fa'], ['#000', '#fffbe6']];
const DARK = [['#ececec', '#212121'], ['#e3e3e3', '#131314'], ['#f5f4ef', '#262624'], ['#c9d1d9', '#0d1117'],
  ['#ffffff', '#000000'], ['#d4d4d4', '#1e1e1e'], ['#e8eaed', '#303134']];
const R = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

function style() {
  const dark = Math.random() < 0.35;
  const [fg, bg] = pick(dark ? DARK : LIGHT);
  return {
    engine: Math.random() < 0.7 ? 'katex' : 'mathjax',
    display: Math.random() < 0.7,
    size: Math.round(Math.exp(R(Math.log(13), Math.log(34)))),
    dpr: Math.random() < 0.5 ? 1 : 2,
    pad: Math.round(R(3, 36)),
    fg, bg, theme: dark ? 'dark' : 'light',
    jpeg: Math.random() < 0.3 ? Math.round(R(45, 92)) : 0,
  };
}

// 사이트 app.js와 같은 처리: 그레이스케일(Rec.601) → 어두운 픽셀이 더 많으면 반전
async function toModelInput(png, jpeg) {
  let img = sharp(png).flatten({ background: '#ffffff' });
  if (jpeg) img = sharp(await img.jpeg({ quality: jpeg }).toBuffer());
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height, g = Buffer.alloc(n);
  let dark = 0;
  for (let i = 0, p = 0; i < n; i++, p += info.channels) {
    g[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) | 0;
    if (g[i] < 200) dark++;
  }
  if (dark >= n - dark) for (let i = 0; i < n; i++) g[i] = 255 - g[i];
  return sharp(g, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

async function worker(browser, queue, stats) {
  const page = await browser.newPage();
  await page.goto('file://' + path.join(OUT, '..', '_render.html'));
  await page.waitForFunction(() => !!(window.katex && window.MathJax && MathJax.startup && MathJax.startup.promise));
  await page.evaluate(() => MathJax.startup.promise);
  while (queue.length) {
    const it = queue.pop();
    const s = style();
    try {
      await page.setViewport({ width: 2400, height: 1200, deviceScaleFactor: s.dpr });
      const ok = await page.evaluate((tex, s) => {
        const box = document.getElementById('box');
        document.body.style.background = s.bg;
        box.style.cssText = `display:inline-block;padding:${s.pad}px;background:${s.bg};color:${s.fg};font-size:${s.size}px`;
        box.innerHTML = '';
        try {
          if (s.engine === 'katex') {
            katex.render(tex, box, { displayMode: s.display, throwOnError: true, strict: 'ignore' });
          } else {
            const n = MathJax.tex2svg(tex, { display: s.display });
            if (n.querySelector('[data-mjx-error], merror')) return false;
            // 화면엔 안 보여야 할 접근성용 MathML이 CSS 없이 그대로 찍히므로 SVG만 남긴다
            box.appendChild(n.querySelector('svg'));
          }
        } catch (e) { return false; }
        return document.fonts.ready.then(() => true);
      }, it.render || it.tex, s);
      if (!ok) { stats.fail++; continue; }
      const el = await page.$('#box');
      const bb = await el.boundingBox();
      if (!bb || bb.width > 2350 || bb.height > 1150) { stats.fail++; continue; }
      const png = await el.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT, it.id + '.png'), await toModelInput(png, s.jpeg));
      labelOut.write(JSON.stringify({ id: it.id, tex: it.tex, engine: s.engine, theme: s.theme, src: it.src }) + '\n');
      stats.ok++;
    } catch (e) { stats.fail++; }
    if ((stats.ok + stats.fail) % 1000 === 0) console.log(new Date().toISOString(), 'ok', stats.ok, 'fail', stats.fail, 'left', queue.length);
  }
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu', '--font-render-hinting=none'],
  });
  const queue = todo.slice().reverse();
  const stats = { ok: 0, fail: 0 };
  await Promise.all(Array.from({ length: +WORKERS }, () => worker(browser, queue, stats)));
  await browser.close();
  labelOut.end();
  console.log('DONE ok', stats.ok, 'fail', stats.fail);
})();
