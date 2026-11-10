'use strict';
/*
 * AI 채팅 보고서 감지 + HWPX 변환 버튼 삽입 — content script
 *
 * 수식 추출 우선순위:
 * 1) KaTeX <annotation encoding="application/x-tex">
 * 2) React fiber props (math / formula / tex / expression / latex)
 * 3) data-math, data-formula 등 속성
 * 4) ChatGPT 텍스트 복사 포맷 [ \n LaTeX \n ] / ( LaTeX ) 패턴 후처리
 */
(function () {
  if (window.__hwpReportExtractInjected) return;
  window.__hwpReportExtractInjected = true;

  // 다국어: 설정 언어(lib 대신 i18n-content.js) 메시지, 없으면 한국어 원문으로 폴백
  function hwpMsg(key, fallback) {
    return window.__hwpMsg ? window.__hwpMsg(key, fallback) : fallback;
  }

  var ready = window.__hwpMsgReady || Promise.resolve(); // i18n-content.js 의 언어 로드
  var storageApi = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  if (storageApi) {
    chrome.storage.sync.get({ autoHwpxReport: true }, function (s) {
      if (s.autoHwpxReport) ready.then(init);
    });
  } else {
    ready.then(init);
  }

  function init() {

  // ── 사이트별 응답 컨텐츠 셀렉터 ──────────────────────────────
  var CONTENT_SELECTORS = [
    '[data-assistant-markdown-root]',                    // ChatGPT (2026-10 DOM 개편 이후)
    '[data-markdown-text-style="assistant-message"]',    // ChatGPT (프로젝트 대화·재개편 DOM, 클래스 MarkdownRoot-*)
    '[data-message-author-role="assistant"] .markdown',  // ChatGPT
    '[data-message-author-role="assistant"] .prose',     // ChatGPT fallback
    '.font-claude-response',                             // Claude.ai (구버전)
    '[data-perf-reply-text]',                            // Claude.ai (2026-10 DOM 개편 이후)
    '.ds-assistant-message-main-content',                // DeepSeek
    '[class*="Markdown_markdownContainer"]',             // Poe (CSS 모듈 해시 접두사)
    '.model-response-text',                             // Gemini
    'model-response .markdown',                         // Gemini (커스텀 엘리먼트 내부)
    '[data-role="model"] .markdown',                    // AI Studio (구버전)
    'ms-cmark-node',                                    // AI Studio (신버전)
    '.prose.dark\\:prose-invert',                       // Grok, Perplexity
    '[data-role="assistant"] .prose',
    '.ai-message .prose',
  ];

  // ── 보고서 판단 (헤딩 2개↑ 또는 2000자↑) ─────────────────────
  function isReport(el) {
    var headings = el.querySelectorAll('h1, h2, h3, h4');
    if (headings.length >= 2) return true;
    return (el.innerText || el.textContent || '').trim().length > 2000;
  }

  // ── ChatGPT 캔버스 감지 ──────────────────────────────────────
  // 캔버스가 있는 메시지에는 버튼 표시하지 않음
  function hasCanvas(el) {
    var container = el.closest('[data-message-author-role="assistant"]') ||
                    el.closest('[data-message-role="assistant"]') ||
                    el.closest('article') || el.parentElement;
    if (!container) return false;
    var selectors = [
      '[data-testid="canvas-turn-action-button"]',
      '[data-testid*="canvas"]:not([data-testid="canvas-trigger"])',  // Grok "N초동안 작업함" 칩 제외
      'button[aria-label*="anvas"]',
      '[class*="canvasTile"]',
      '[class*="canvas-tile"]',
      '[data-canvas-id]',
      '[data-type="canvas"]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      try { if (container.querySelector(selectors[i])) return true; } catch (e) {}
    }
    return false;
  }

  // ── React fiber에서 LaTeX prop 추출 (ChatGPT 등 React 사이트) ──
  function getLatexFromFiber(el) {
    var fiberKey = null;
    try {
      var ks = Object.keys(el);
      for (var i = 0; i < ks.length; i++) {
        if (ks[i].startsWith('__reactFiber') || ks[i].startsWith('__reactInternalInstance')) {
          fiberKey = ks[i]; break;
        }
      }
    } catch (e) { return null; }
    if (!fiberKey) return null;

    var fiber = el[fiberKey];
    var limit = 50;
    while (fiber && limit-- > 0) {
      try {
        var p = fiber.memoizedProps;
        if (p) {
          // react-katex: math / BlockMath / InlineMath props
          var propKeys = ['math', 'formula', 'tex', 'expression', 'latex', 'value'];
          for (var j = 0; j < propKeys.length; j++) {
            var v = p[propKeys[j]];
            if (typeof v === 'string' && v.length > 0) return v;
          }
          // children가 LaTeX 문자열인 경우 (\, {, }, ^, _ 포함)
          if (typeof p.children === 'string' && /[\\{}^_]/.test(p.children)) {
            return p.children;
          }
        }
      } catch (e) { /* ignore */ }
      fiber = fiber.return;
    }
    return null;
  }

  // ── KaTeX / MathJax에서 LaTeX 추출 (다중 전략) ───────────────
  function getLatex(el) {
    // 1) KaTeX annotation (htmlAndMathml 렌더 모드)
    var ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent.trim()) {
      var raw = ann.textContent.trim();
      // annotation에 구분자가 포함된 경우 strip ($$ ... $$, \[ ... \], \( ... \), $ ... $)
      raw = raw.replace(/^\$\$([\s\S]*)\$\$$/, '$1')
               .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
               .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
               .replace(/^\$([\s\S]*)\$$/, '$1')
               .trim();
      return raw;
    }

    // 2) React fiber props (ChatGPT, react-katex 등)
    var fromFiber = getLatexFromFiber(el);
    if (fromFiber) return fromFiber;

    // 3) data 속성 — el부터 5단계 조상까지
    //    data-math-source: ChatGPT(role="math" 래퍼, KaTeX HTML 전용 렌더라 annotation 없음)
    var dataKeys = ['data-formula', 'data-math', 'data-math-source', 'data-latex', 'data-tex', 'data-expression', 'data-content'];
    var cur = el;
    for (var d = 0; d < 5; d++) {
      for (var i = 0; i < dataKeys.length; i++) {
        try {
          var attr = cur.getAttribute && cur.getAttribute(dataKeys[i]);
          if (attr && attr.trim()) return attr.trim();
        } catch (e) {}
      }
      if (!cur.parentElement) break;
      cur = cur.parentElement;
    }

    // 4) Gemini: data-math on ancestor (already covered above)
    return null;
  }

  // data-math 값이 한국어 비율이 높고 수식 기호가 거의 없는 경우 → 텍스트로 처리
  // 예: "압력 P" (수식 기호 없음), "온도 T와 압력" (한국어 비율 높음)
  function isKoreanHeavyMath(latex) {
    var korLen = (latex.match(/[가-힣]/g) || []).length;
    if (!korLen) return false;
    // 역슬래시 명령이나 수식 기호(_^=)가 있으면 수식으로 처리
    if (/\\[a-zA-Z]/.test(latex) || /[_^=<>+\-*/|{}]/.test(latex)) return false;
    // 수식 기호 없이 한국어가 한 글자라도 있으면 텍스트
    return true;
  }

  // \text{한국어...} 비율이 수식 부분보다 훨씬 많은 경우 → 텍스트로 처리
  // 예: "\text{상평형 선을 따라} dT, dP \text{만큼}"
  function isTextHeavyLatex(latex) {
    var textContent = '';
    var withoutText = latex.replace(/\\(?:text|mathrm|textbf|textrm)\{([^}]*)\}/g, function (_, t) {
      textContent += t;
      return '';
    });
    if (!/[가-힣]/.test(textContent)) return false;
    // 나머지 수식 기호 (공백·구두점 제외)
    var mathPart = withoutText.replace(/[\s,;.()\[\]]/g, '').trim();
    return textContent.replace(/\s/g, '').length > mathPart.length * 1.5;
  }

  // 인라인 LaTeX 필터: 한국어·텍스트 위주이면 텍스트로, 수식이면 $...$로 반환
  function filterLatexInline(latex, fallbackNode) {
    if (!latex) return (fallbackNode.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^[가-힣㄰-㆏\s.,!?:;()\[\]\-·]+$/.test(latex)) return latex;
    if (/^[A-Za-z]+(\s+[A-Za-z,.-]+)+$/.test(latex)) return latex;
    if (isKoreanHeavyMath(latex)) return latex;
    if (/\\(?:text|mathrm|textbf|textrm)\{[^}]*[가-힣]/.test(latex)) {
      return splitMixedLatex(latex, fallbackNode);
    }
    return '$' + latex + '$';
  }

  // idx 위치 직전까지의 열린 중괄호 깊이 (이스케이프된 \{ \} 는 제외)
  function braceDepthAt(s, idx) {
    var depth = 0;
    for (var i = 0; i < idx; i++) {
      var ch = s.charAt(i);
      if (ch === '\\') { i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    return depth;
  }

  // \text{한국어...} 가 포함된 인라인 LaTeX를 텍스트·수식 조각으로 분리해 Markdown 반환.
  // 예: "\text{다음이 성립} dT = dP" → "다음이 성립 $dT = dP$"
  function splitMixedLatex(latex, fallbackNode) {
    var parts = [];
    var re = /\\(?:text|mathrm|textbf|textrm|textit)\{([^}]*)\}/g;
    var last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(latex)) !== null) {
      // 첨자·인자 안(중괄호 깊이 > 0)의 \text{...}는 분리하면 수식이 깨진다
      // 예: \Delta S_{\text{전체}} → 통째로 수식으로 유지
      if (braceDepthAt(latex, m.index) > 0) continue;
      var before = latex.slice(last, m.index).trim();
      if (before) parts.push({ t: 'math', v: before });
      var txt = m[1].trim();
      if (txt) parts.push({ t: 'text', v: txt });
      last = m.index + m[0].length;
    }
    var after = latex.slice(last).trim();
    if (after) parts.push({ t: 'math', v: after });
    if (!parts.length) return (fallbackNode.textContent || '').replace(/\s+/g, ' ').trim();
    // 최상위 \text 가 없었다면 분리 없이 원본 전체가 수식 하나
    if (parts.length === 1 && parts[0].t === 'math') return '$' + latex.trim() + '$';
    return parts.map(function (p) {
      if (p.t === 'text') return p.v;
      // 수식 기호(역슬래시·첨자·등호·연산자·알파벳)가 없으면 텍스트로
      if (!/[\\{}^_=+\-*/|a-zA-Z]/.test(p.v)) return p.v;
      return '$' + p.v + '$';
    }).join('');
  }

  // ── DOM → Markdown 변환 ──────────────────────────────────────
  function domToMd(root) {
    var raw = nodeToMd(root).trim();
    // ChatGPT 텍스트 복사 포맷 후처리:
    // [\nLaTeX\n===\n...\n] → $$LaTeX$$
    // * (\LaTeX): ... → * $\LaTeX$: ...
    raw = fixChatGPTMathFormat(raw);
    return collapseBlankLines(raw);
  }

  // ChatGPT 텍스트 복사 포맷 후처리
  // block: 독립 줄의 [ \n LaTeX \n ] → $$LaTeX$$
  // inline: (\LaTeX) 패턴 (역슬래시 명령 포함) → $LaTeX$   ($$...$$ 내부 제외)
  function fixChatGPTMathFormat(text) {
    // Step 1: === 구분선 → = 기호 (줄 전체가 = 이상인 경우)
    text = text.replace(/\n={3,}\n/g, '\n=\n');

    // Step 2: [ \n ... \n? ] 블록 → $$...$$
    // ] 가 마지막 수식 줄 끝에 붙어 있는 경우(\n 없이)도 처리한다.
    // LaTeX 명령(\command)이 포함된 경우에만 변환해 일반 링크 참조를 보호한다.
    text = text.replace(/(?:^|\n)\[\n([\s\S]*?)\n?\](?=\n|$)/gm, function (match, content) {
      var latex = content.trim().replace(/\n+/g, ' ').trim();
      if (!latex || !/\\[A-Za-z]/.test(latex)) return match;
      return '\n\n$$' + latex + '$$\n\n';
    });

    // Step 3: 인라인 ( LaTeX ) → $ LaTeX $ 단, $$...$$ 블록과 $...$ 인라인 수식 내부는 건드리지 않음
    // ($(\mathbf{u} \cdot \nabla)\mathbf{u}$ 의 괄호를 또 $ 로 감싸 `$$…$…$` 가 되는 것을 막는다)
    var segments = text.split(/([$][$][\s\S]*?[$][$]|[$][^$\n]+[$])/g);
    for (var i = 0; i < segments.length; i += 2) {  // 짝수 인덱스 = 블록 밖
      segments[i] = segments[i].replace(/\(([^)\n]{1,200}?)\)/g, function (m, inner) {
        if (/\$/.test(inner)) return m;  // 이미 $..$ 수식 포함 → 건드리지 않음
        if (/\\[a-zA-Z]/.test(inner) && !/^https?/.test(inner)) {
          return '$' + inner.trim() + '$';
        }
        return m;
      });
    }
    return segments.join('');
  }

  function collapseBlankLines(s) {
    return s.replace(/\n{3,}/g, '\n\n');
  }

  // AI Studio(Angular) 는 <ul><ms-cmark-node><li>...</li></ms-cmark-node></ul> 처럼
  // 재귀 렌더러가 블록 요소마다 래퍼(예: ms-cmark-node)를 한 겹 더 씌운다.
  // node 부터 시작해 "엘리먼트 자식이 정확히 1개뿐인" 래퍼를 계속 벗겨 실제 태그를 찾는다.
  function unwrapSingleChildElement(node) {
    var cur = node;
    while (cur && cur.nodeType === 1) {
      var elChild = null, count = 0, hasText = false;
      for (var i = 0; i < cur.childNodes.length; i++) {
        var c = cur.childNodes[i];
        if (c.nodeType === 1) { elChild = c; count++; }
        else if (c.nodeType === 3 && (c.textContent || '').trim()) hasText = true;
      }
      if (hasText || count !== 1) return cur;
      cur = elChild;
    }
    return cur;
  }

  // listEl 의 직계 <li> 들을 찾는다 — 래퍼(ms-cmark-node 등)에 감싸져 있어도 통과한다.
  // 단, 다른 ul/ol 안에 중첩된 li(하위 리스트 항목)는 제외한다.
  function directListItems(listEl) {
    var all = listEl.querySelectorAll('li');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var li = all[i];
      var ancestor = li.parentElement;
      while (ancestor && ancestor !== listEl && ancestor.tagName !== 'UL' && ancestor.tagName !== 'OL') {
        ancestor = ancestor.parentElement;
      }
      if (ancestor === listEl) out.push(li);
    }
    return out;
  }

  // node(또는 그 래퍼)가 감싸고 있는 ul/ol 을 찾는다. 아니면 null.
  function findWrappedList(node) {
    var real = unwrapSingleChildElement(node);
    if (real && real.nodeType === 1 && (real.tagName === 'UL' || real.tagName === 'OL')) return real;
    return null;
  }

  function childrenMd(node) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      out += nodeToMd(node.childNodes[i]);
    }
    return out;
  }

  function listItemMd(li, ordered, idx) {
    var bullet = ordered ? (idx + 1) + '. ' : '- ';
    var input = li.querySelector('input[type="checkbox"]');
    if (input) bullet = input.checked ? '- [x] ' : '- [ ] ';

    var direct = '';
    var nested = '';
    for (var i = 0; i < li.childNodes.length; i++) {
      var c = li.childNodes[i];
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
        nested += '\n' + listToMd(c, c.tagName === 'OL', 1);
      } else if (c.nodeType === 1 && c.tagName === 'INPUT') {
        // skip checkbox
      } else {
        var wrapped = c.nodeType === 1 ? findWrappedList(c) : null;
        if (wrapped) {
          nested += '\n' + listToMd(wrapped, wrapped.tagName === 'OL', 1);
        } else {
          direct += nodeToMd(c);
        }
      }
    }
    return bullet + direct.trim() + nested;
  }

  function listToMd(listEl, ordered, depth) {
    depth = depth || 0;
    var indent = '  '.repeat(depth);
    var lines = [];
    var liEls = directListItems(listEl);
    for (var i = 0; i < liEls.length; i++) {
      lines.push(indent + listItemMd(liEls[i], ordered, i));
    }
    return lines.join('\n');
  }

  function tableToMd(table) {
    var rows = table.querySelectorAll('tr');
    if (!rows.length) return '';
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('th, td');
      var vals = [];
      for (var j = 0; j < cells.length; j++) {
        vals.push(childrenMd(cells[j]).trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
      }
      lines.push('| ' + vals.join(' | ') + ' |');
      if (i === 0) {
        lines.push('| ' + vals.map(function () { return '---'; }).join(' | ') + ' |');
      }
    }
    return lines.join('\n');
  }

  function nodeToMd(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';

    var tag = node.tagName.toLowerCase();
    if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) return '';
    if (tag === 'script' || tag === 'style' || tag === 'button' || tag === 'svg' ||
        tag === 'nav' || tag === 'header' || tag === 'footer') return '';

    // ── 수식 ────────────────────────────────────────────────────
    // AI Studio: ms-katex > pre > code.rendered > .katex-display > .katex
    // pre/code 태그가 안쪽에 있어 아래 일반 pre 분기(코드블록화)보다 먼저 가로채야 한다.
    if (tag === 'ms-katex') {
      var mkKatex = node.querySelector('.katex');
      var mkLat = mkKatex ? getLatex(mkKatex) : null;
      if (!mkLat) return '';
      var mkIsBlock = node.classList && node.classList.contains('display');
      return mkIsBlock ? '\n\n$$' + mkLat + '$$\n\n' : filterLatexInline(mkLat, mkKatex);
    }
    // Gemini: DIV.math-block (블록 수식) — data-math 직접 사용
    if (node.classList && node.classList.contains('math-block')) {
      var gdm = node.getAttribute('data-math');
      if (gdm && gdm.trim()) return '\n\n$$' + gdm.trim() + '$$\n\n';
      var gkd = node.querySelector('.katex-display .katex') || node.querySelector('.katex');
      if (gkd) { var gkl = getLatex(gkd); if (gkl) return '\n\n$$' + gkl + '$$\n\n'; }
      return '';
    }
    // Gemini: SPAN.math-inline (인라인 수식)
    if (tag === 'span' && node.classList && node.classList.contains('math-inline')) {
      if (node.closest && node.closest('.math-block')) return '';
      // 자식 .katex의 annotation 우선 사용 (data-math보다 정확)
      var miKatex = node.querySelector && node.querySelector('.katex');
      if (miKatex) {
        var miAnn = miKatex.querySelector('annotation[encoding="application/x-tex"]');
        if (miAnn && miAnn.textContent.trim()) {
          return filterLatexInline(miAnn.textContent.trim(), miKatex);
        }
      }
      // annotation 없으면 data-math 폴백
      var gim = node.getAttribute('data-math');
      if (gim) return filterLatexInline(gim.trim(), node);
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    if (node.classList && node.classList.contains('katex-display')) {
      var kinner = node.querySelector('.katex');
      if (kinner) {
        var klat = getLatex(kinner);
        if (klat) {
          // \text{한국어} 비율이 수식 부분보다 훨씬 많으면 textContent 폴백
          if (isTextHeavyLatex(klat)) {
            var tcText = (kinner.textContent || '').replace(/\s+/g, ' ').trim();
            return tcText ? '\n\n' + tcText + '\n\n' : '';
          }
          return '\n\n$$' + klat + '$$\n\n';
        }
      }
      // annotation 없으면 inner .katex 직접 시도
      var klat2 = getLatex(node);
      if (klat2) return '\n\n$$' + klat2 + '$$\n\n';
      // 마지막 폴백: 텍스트로 감싸 보존
      var fbText = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return fbText ? '\n\n$$' + fbText + '$$\n\n' : '';
    }
    if (node.classList && node.classList.contains('katex')) {
      if (node.closest && node.closest('.katex-display')) return '';
      var lat2 = getLatex(node);
      if (lat2) {
        var lat2t = lat2.trim();
        // 순수 영어 단어들 (LaTeX 명령·수식 기호 없음) → 텍스트
        if (/^[A-Za-z][A-Za-z0-9\s,.\-()]+$/.test(lat2t) && !/\\[a-zA-Z]/.test(lat2t) && !/[_^{}=<>]/.test(lat2t)) return lat2t;
        return filterLatexInline(lat2t, node);
      }
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // MathJax (Gemini 등)
    if (tag === 'mjx-container') {
      var mjAnn = node.querySelector('annotation[encoding="application/x-tex"]');
      if (mjAnn) {
        var isBlk = node.getAttribute('display') === 'true';
        var lat3 = mjAnn.textContent.trim();
        return isBlk ? '\n\n$$' + lat3 + '$$\n\n' : '$' + lat3 + '$';
      }
      return node.textContent || '';
    }

    // ── 블록 요소 ────────────────────────────────────────────────
    if (/^h[1-6]$/.test(tag)) {
      return '\n\n' + '#'.repeat(parseInt(tag[1], 10)) + ' ' + childrenMd(node).trim() + '\n\n';
    }
    if (tag === 'p') return '\n\n' + childrenMd(node).trim() + '\n\n';
    if (tag === 'pre') {
      var codeEl = node.querySelector('code');
      var lm = (codeEl && (codeEl.className || '')).match(/language-(\S+)/);
      var codeText = (codeEl || node).textContent || '';
      return '\n\n```' + (lm ? lm[1] : '') + '\n' + codeText.replace(/\n$/, '') + '\n```\n\n';
    }
    if (tag === 'blockquote') {
      var bql = childrenMd(node).trim().split('\n');
      return '\n\n' + bql.map(function (l) { return '> ' + l; }).join('\n') + '\n\n';
    }
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'br') return '\n';
    if (tag === 'ul') return '\n\n' + listToMd(node, false, 0) + '\n\n';
    if (tag === 'ol') return '\n\n' + listToMd(node, true, 0) + '\n\n';
    if (tag === 'li') return listItemMd(node, false, 0);
    if (tag === 'table') return '\n\n' + tableToMd(node) + '\n\n';

    // ── 인라인 요소 ──────────────────────────────────────────────
    if (tag === 'strong' || tag === 'b') return '**' + childrenMd(node).trim() + '**';
    if (tag === 'em' || tag === 'i') return '*' + childrenMd(node).trim() + '*';
    if (tag === 'del' || tag === 's') return '~~' + childrenMd(node).trim() + '~~';
    if (tag === 'code') {
      if (node.closest && node.closest('pre')) return node.textContent || '';
      return '`' + (node.textContent || '') + '`';
    }
    if (tag === 'a') {
      var href = node.getAttribute('href');
      var lt = childrenMd(node).trim();
      if (href && !href.startsWith('javascript:')) return '[' + lt + '](' + href + ')';
      return lt;
    }
    return childrenMd(node);
  }

  // ── 응답 컨테이너 탐색 ──────────────────────────────────────
  // 셀렉터 기반만 쓴다. "헤딩 N개↑이면 응답" 같은 구조 추측 폴백은 0.8.0~0.8.2에서
  // 앱 UI(AI Studio 에디터·설정 패널)·사용자 말풍선에 버튼을 남발해 제거했다.
  // 사이트 DOM이 개편돼 버튼이 안 뜨면 CONTENT_SELECTORS 에 셀렉터를 추가할 것.
  function findContainers() {
    var seen = new Set();
    var results = [];
    for (var i = 0; i < CONTENT_SELECTORS.length; i++) {
      try {
        var found = document.querySelectorAll(CONTENT_SELECTORS[i]);
        for (var j = 0; j < found.length; j++) {
          if (!seen.has(found[j])) {
            seen.add(found[j]);
            results.push(found[j]);
          }
        }
      } catch (e) {}
    }
    // 다른 요소의 조상인 요소 제거 — 셀렉터가 조상·자손 쌍을 둘 다 잡을 때 중복 버튼 방지
    // 단, ms-cmark-node(AI Studio)는 문단·강조마다 재귀적으로 중첩되는 구조라
    // 위 규칙을 그대로 적용하면 전체 응답을 담은 최상위가 걸러지고 텍스트 몇 글자뿐인
    // 최말단 leaf만 남는다 → isReport() 실패 → 버튼 미표시. 이 태그만 반대로 최상위만 남긴다.
    return results.filter(function (el) {
      if (el.tagName === 'MS-CMARK-NODE') {
        // AI Studio: 사용자가 입력한 프롬프트도 ms-cmark-node 로 렌더링되므로
        // 실수로 버튼이 붙지 않게 사용자 turn 은 애초에 제외한다.
        if (el.closest && el.closest('.chat-turn-container.user')) return false;
        return !results.some(function (other) {
          return other !== el && other.tagName === 'MS-CMARK-NODE' && other.contains(el);
        });
      }
      return !results.some(function (other) {
        return other !== el && el.contains(other);
      });
    });
  }

  // ── AI Studio: "Copy as markdown" 메뉴로 원본 markdown 확보 ──────
  //
  // domToMd() 는 렌더링된 DOM을 역으로 markdown 으로 재구성하는 방식이라
  // Angular 컴포넌트 래핑(ms-cmark-node 재귀 중첩), KaTeX 렌더 실패 등 화면 표시
  // 디테일에 취약하다. AI Studio 는 각 turn 의 "더보기(⋮)" 메뉴에 원본 markdown을
  // 그대로 클립보드로 복사해주는 "Copy as markdown" 항목을 제공하므로, 있으면
  // 그걸 우선 사용하고 실패했을 때만 domToMd() 로 폴백한다.
  function tryAiStudioCopyMarkdown(el) {
    if (location.hostname !== 'aistudio.google.com') return Promise.resolve(null);
    var turn = el.closest('ms-chat-turn');
    if (!turn) return Promise.resolve(null);
    var optionsBtn = turn.querySelector('ms-chat-turn-options button[aria-haspopup="menu"]');
    if (!optionsBtn) return Promise.resolve(null);

    return new Promise(function (resolve) {
      var done = false;
      var observer;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        resolve(null);
      }, 3000);

      observer = new MutationObserver(function () {
        if (done) return;
        var copyItem = document.querySelector('.copy-markdown-button');
        if (!copyItem) return;
        done = true;
        clearTimeout(timer);
        observer.disconnect();
        var copyBtn = copyItem.closest('button');
        if (!copyBtn) { resolve(null); return; }
        copyBtn.click();
        // 클립보드 쓰기가 비동기라 약간의 여유를 두고 읽는다.
        setTimeout(function () {
          navigator.clipboard.readText().then(function (text) {
            resolve(text || null);
          }).catch(function () { resolve(null); });
        }, 150);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      optionsBtn.click();
    });
  }

  // ── 버튼 삽입 ────────────────────────────────────────────────
  var BTN_ATTR = 'data-hwp-report-added';

  function addButton(el) {
    if (el.getAttribute(BTN_ATTR)) return;
    if (!isReport(el)) return;
    if (hasCanvas(el)) return; // 캔버스 생성된 메시지는 스킵

    el.setAttribute(BTN_ATTR, '1');

    var bar = document.createElement('div');
    bar.className = 'hwp-report-bar';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hwp-report-btn';
    btn.textContent = hwpMsg('btnToHwpx', 'hwpx파일로');
    btn.title = hwpMsg('btnToHwpxTitle', 'AI 응답을 HWPX 문서로 변환합니다');

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // 확장 context 무효화(재로드) 시 chrome API 접근 차단
      try { void chrome.runtime.id; } catch (ex) { return; }
      btn.textContent = hwpMsg('extracting', '추출 중…');
      btn.disabled = true;

      tryAiStudioCopyMarkdown(el).catch(function () { return null; }).then(function (copiedMd) {
        var md = copiedMd && copiedMd.trim() ? copiedMd : '';
        if (!md) {
          try { md = domToMd(el); } catch (err) { md = ''; }
        }

        if (!md || !md.trim()) {
          btn.textContent = hwpMsg('extractFailed', '추출 실패');
          btn.disabled = false;
          setTimeout(function () { btn.textContent = hwpMsg('btnToHwpx', 'hwpx파일로'); }, 2000);
          return;
        }

        chrome.storage.local.set({ hwpxReportMd: md.trim() }, function () {
          if (chrome.runtime.lastError) {
            btn.textContent = hwpMsg('saveFailed', '저장 실패');
            btn.disabled = false;
            setTimeout(function () { btn.textContent = hwpMsg('btnToHwpx', 'hwpx파일로'); }, 2000);
            return;
          }
          chrome.runtime.sendMessage({ type: 'open-report-popup' }, function () {
            void chrome.runtime.lastError;
            btn.textContent = hwpMsg('btnToHwpx', 'hwpx파일로');
            btn.disabled = false;
          });
        });
      });
    });

    bar.appendChild(btn);
    var parent = el.parentElement;
    if (parent) parent.insertBefore(bar, el.nextSibling);
    else el.appendChild(bar);
  }

  function scan() {
    var containers = findContainers();
    for (var i = 0; i < containers.length; i++) {
      addButton(containers[i]);
    }
  }

  scan();
  var scanTimer = null;
  var observer = new MutationObserver(function () {
    // 확장 context 무효화(재로드) 시 observer 정지
    try { void chrome.runtime.id; } catch (e) { observer.disconnect(); return; }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  } // end init
})();
