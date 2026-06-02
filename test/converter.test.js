'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { convert } = require('../src/converter.js');

// 골든 케이스 (CLAUDE.md / CONVERSION_RULES.md의 기준 예시)
// HWP에서 공백은 표시되지 않고 항 구분 용도이므로, 출력은 사용자 원본 골든과
// "표시상 동일"하다. 여기서는 변환기의 정규화된 출력을 스냅샷으로 고정한다.
test('골든 예시 변환', () => {
  const input =
    '$$\\lambda(t) = \\lambda_0 + A_1 \\sin\\left(\\frac{2\\pi}{24}(t - \\phi_1)\\right) + A_2 \\sin\\left(\\frac{2\\pi}{12}(t - \\phi_2)\\right)$$';
  const expected =
    'lambda (t) `=` lambda _{0} `+` A _{1} sin LEFT( {2 pi} over {24} (t `-` phi _{1}) RIGHT) `+` A _{2} sin LEFT( {2 pi} over {12} (t `-` phi _{2}) RIGHT)';
  assert.strictEqual(convert(input), expected);
});

test('분수: \\frac{a}{b} → {a} over {b}', () => {
  assert.strictEqual(convert('\\frac{a}{b}'), '{a} over {b}');
  assert.strictEqual(convert('\\frac{2\\pi}{24}'), '{2 pi} over {24}');
});

test('첨자: 단일/그룹, 여러 자리 숫자는 묶음', () => {
  assert.strictEqual(convert('x^2'), 'x ^{2}');
  assert.strictEqual(convert('y_{ij}'), 'y _{i j}');
  assert.strictEqual(convert('x_{12}^{34}'), 'x _{12} ^{34}');
});

test('제곱근 / n제곱근', () => {
  assert.strictEqual(convert('\\sqrt{2}'), 'sqrt {2}');
  assert.strictEqual(convert('\\sqrt[3]{x+1}'), '^{3} sqrt {x `+` 1}');
});

test('합/적분/극한', () => {
  assert.strictEqual(convert('\\sum_{i=1}^{n}'), 'sum _{i `=` 1} ^{n}');
  assert.strictEqual(convert('\\int_0^1'), 'int _{0} ^{1}');
  assert.strictEqual(convert('\\lim_{x \\to 0}'), 'lim _{x rarrow 0}');
});

test('그리스 문자는 이름 그대로 (대소문자 유지)', () => {
  assert.strictEqual(convert('\\alpha'), 'alpha');
  assert.strictEqual(convert('\\Omega'), 'Omega');
  assert.strictEqual(convert('\\varphi'), 'varphi');
});

test('연산/집합 기호 매핑', () => {
  assert.strictEqual(convert('A \\cup B'), 'A union B');
  assert.strictEqual(convert('A \\cap B'), 'A inter B');
  assert.strictEqual(convert('a \\leq b'), 'a leq b');
  assert.strictEqual(convert('\\infty'), 'inf');
});

test('이항 연산자는 좁은 공백(`)으로 감쌈', () => {
  assert.strictEqual(convert('a - b'), 'a `-` b');
  assert.strictEqual(convert('a + b = c'), 'a `+` b `=` c');
});

test('행렬 / cases 환경', () => {
  assert.strictEqual(
    convert('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'),
    'pmatrix{ a & b # c & d }'
  );
  assert.strictEqual(
    convert('\\begin{bmatrix} 1 & 2 \\end{bmatrix}'),
    'bmatrix{ 1 & 2 }'
  );
});

test('함수는 그대로, \\left \\right는 LEFT(/RIGHT)로', () => {
  assert.strictEqual(convert('\\sin x'), 'sin x');
  assert.strictEqual(convert('\\left( x \\right)'), 'LEFT( x RIGHT)');
  assert.strictEqual(convert('\\left[ x \\right]'), 'LEFT[ x RIGHT]');
  // \left. 는 빈 구분자(.)를 보존, \right| 의 vert는 키워드와 공백으로 분리한다.
  // (표시상 사용자 골든 'LEFT. {df} over {dx} RIGHT | _{x=a}' 와 동일)
  assert.strictEqual(
    convert('\\left. \\frac{df}{dx} \\right|_{x=a}'),
    'LEFT. {d f} over {d x} RIGHT | _{x `=` a}'
  );
});

test('수식 구분자($$, $, \\[ \\])는 제거', () => {
  assert.strictEqual(convert('$x+1$'), 'x `+` 1');
  assert.strictEqual(convert('$$x+1$$'), 'x `+` 1');
  assert.strictEqual(convert('\\[x+1\\]'), 'x `+` 1');
});

test('빈 입력은 빈 문자열', () => {
  assert.strictEqual(convert(''), '');
  assert.strictEqual(convert('   '), '');
});

test('substack 지원 (matrix로 변환)', () => {
  assert.strictEqual(
    convert('\\sum_{\\substack{i=1\\\\j=2}}^n'),
    'sum _{matrix{i `=` 1 # j `=` 2}} ^{n}'
  );
});

test('overset / underset 지원', () => {
  // 특정 매핑: \overset{!}{=} -> !=
  assert.strictEqual(convert('\\overset{!}{=}'), '!=');
  // 일반 overset
  assert.strictEqual(convert('\\overset{a}{b}'), 'REL b {a} {}');
  // underset + lim
  assert.strictEqual(convert('\\underset{x \\to 0}{\\lim}'), 'lim _{x rarrow 0}');
  // 일반 underset
  assert.strictEqual(convert('\\underset{a}{b}'), 'REL b {} {a}');
});

test('underbrace / overbrace (라벨을 앞, 본문을 뒤로)', () => {
  // 표시상 사용자 골든 'UNDERBRACE {`=`r ^{2}} {x ^{2} `+`y ^{2} `+`z ^{2}}' 와 동일
  assert.strictEqual(
    convert('\\underbrace{x^2 + y^2 + z^2}_{= r^2}'),
    'UNDERBRACE {`=` r ^{2}} {x ^{2} `+` y ^{2} `+` z ^{2}}'
  );
  assert.strictEqual(convert('\\overbrace{a+b}^{n}'), 'OVERBRACE {n} {a `+` b}');
});

test('AI 전용 오타/패턴 대응', () => {
  // \fras typo
  assert.strictEqual(convert('\\fras{1}{2}'), '{1} over {2}');
  // 텍스트 섞임 및 한글 지원
  assert.strictEqual(convert('안녕하세요 $$\\frac{1}{2}$$'), '"안녕하세요" {1} over {2}');
});

test('수식 글꼴 명령: 한글에 없는 글꼴은 글자만 남김 (mathbf만 bold)', () => {
  // 캘리그래픽/이중선체/필기체/세리프 → 글꼴 장식 버리고 글자만 (키워드 노출 금지)
  assert.strictEqual(convert('\\mathcal{D}'), 'D');
  assert.strictEqual(convert('\\mathbb{R}'), 'R');
  assert.strictEqual(convert('\\mathscr{L}'), 'L');
  assert.strictEqual(convert('\\mathfrak{g}'), 'g');
  // 첨자는 보존되어야 한다
  assert.strictEqual(convert('\\mathbb{R}^n'), 'R ^{n}');
  // mathbf 는 한글이 지원하므로 bold 유지
  assert.strictEqual(convert('\\mathbf{x}'), 'bold x');
  // 실제 사용 맥락 (Grok 보고 사례)
  assert.strictEqual(convert('f:\\mathcal{D}\\to\\mathbb{R}'), 'f : D rarrow R');
});

test('\\boxed → {BOX{...}} 변환', () => {
  assert.strictEqual(convert('\\boxed{x}'), '{BOX{x}}');
  assert.strictEqual(
    convert('$$\\boxed{; N^*(t) = \\frac{\\lambda(t)}{\\mu} + \\frac{1}{\\mu}\\sqrt{\\frac{p \\lambda(t) \\mu}{c}} ;}$$'),
    '{BOX{; N ^{*} (t) `=` {lambda (t)} over {mu} `+` {1} over {mu} sqrt {{p lambda (t) mu} over {c}} ;}}'
  );
});

test('손실된 위첨자 별표 복원: ^$, ^_, [A-Z]^(복잡한 본문)', () => {
  // 수식 종료 직전의 빈 위첨자 — 항상 별표 손실로 본다.
  assert.strictEqual(convert('$N^$'), 'N ^{*}');
  // 빈 위첨자 + 아래첨자 — 항상 별표 손실로 본다.
  assert.strictEqual(convert('$N^_0$'), 'N ^{*} _{0}');
  // 대문자 변수 + ^(복잡한 본문) — 별표 손실로 본다.
  assert.strictEqual(convert('$N^(t + \\tau)$'), 'N ^{*} (t `+` tau)');
  // 영문자 1~2자 ^(letter) 패턴은 기존대로 복원.
  assert.strictEqual(convert('$N^(t)$'), 'N ^{*} (t)');
  // 소문자 변수 + ^(복잡한 본문) 은 손대지 않는다 (e^(x+y) 같은 비형식 표기 보호).
  // 별표가 들어가지 않은 채 본문이 위첨자 그룹으로 해석되는 기존 동작 유지.
  assert.strictEqual(convert('$e^(x+y)$'), 'e ^{(} x `+` y)');
});

test('오류 케이스: n in N Rarr n geq 1 특수 띄어쓰기 및 대문자 매핑', () => {
  assert.strictEqual(
    convert('$$n \\in \\mathbb { N } \\Rarr n \\geq 1$$'),
    'n ` IN ` N RARROW n geq 1'
  );
});
