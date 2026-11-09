'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { convert } = require('../src/converter.js');

// examples.html의 한글 수식은 변환기 출력을 정적으로 박아 둔 것이다.
// 변환 로직이 바뀌면 이 테스트가 깨지므로, 그때 예시 페이지의 결과도 함께 고친다.
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('예시 페이지의 한글 수식 = 현재 변환기 출력', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'examples.html'), 'utf8');
  const blocks = html.split('<div class="ex" data-ex>').slice(1);
  assert.ok(blocks.length > 0, '예시 블록이 없음');
  for (const b of blocks) {
    const tex = unescape(b.match(/<code id="tex\d+">([\s\S]*?)<\/code>/)[1]);
    const hwp = unescape(b.match(/<code id="hwp\d+">([\s\S]*?)<\/code>/)[1]);
    assert.strictEqual(unescape(b.match(/data-latex="([^"]*)"/)[1]), tex, '렌더용 LaTeX 불일치');
    assert.strictEqual(hwp, convert(tex), tex);
  }
});
