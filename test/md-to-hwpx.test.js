'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { fixCjkEmphasisHtml, maskMulticolumn } = require('../src/md-to-hwpx.js');

test('굵게: 앞 쌍의 닫는 ** 를 다음 쌍의 여는 것으로 오인하지 않는다', () => {
  assert.strictEqual(
    fixCjkEmphasisHtml('**초기(1~3)비교**: 시행 **4~13**에서는'),
    '**초기(1~3)비교**: 시행 <strong>4~13</strong>에서는'
  );
});

test('굵게: 한글 조사가 바로 붙은 쌍은 strong 으로 변환', () => {
  assert.strictEqual(fixCjkEmphasisHtml('**사과**는 맛있다'), '<strong>사과</strong>는 맛있다');
});

test('\\multicolumn{n}{c|}{내용} → 표식 + 내용 (서식의 | 제거)', () => {
  assert.strictEqual(
    maskMulticolumn('| 평균 | \\multicolumn{5}{c|}{전체 {x} 평균} |'),
    '| 평균 | MDHWPMCOL5END전체 {x} 평균 |'
  );
});
