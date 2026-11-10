'use strict';

/*
 * LaTeX → 한글(HWP) 수식 복사 — content script
 *
 * 수식(.katex)에 마우스를 올리면 오른쪽 아래 "HWP 복사" 버튼이 뜨고, 클릭하면
 * <annotation encoding="application/x-tex">의 원본 LaTeX를 변환·복사한다.
 * (강제 적용 모드에서는 MathJax · MathML도 지원)
 */
(function () {
  if (window.__hwpFormulaCopyInjected) return; // 중복 주입 방지
  window.__hwpFormulaCopyInjected = true;

  var ready = window.__hwpMsgReady || Promise.resolve(); // i18n-content.js 의 언어 로드
  var storageApi = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  if (storageApi) {
    chrome.storage.sync.get({ autoFormulaCopy: true }, function (s) {
      if (s.autoFormulaCopy) ready.then(init);
    });
  } else {
    ready.then(init);
  }

  function init() {

  // 다국어: 설정 언어(lib 대신 i18n-content.js) 메시지, 없으면 한국어 원문으로 폴백
  function hwpMsg(key, fallback) {
    return window.__hwpMsg ? window.__hwpMsg(key, fallback) : fallback;
  }
  var BTN_LABEL = hwpMsg('btnCopyHwp', 'HWP 복사');

  // 강제 적용 사이트면 셀렉터와 추출 경로를 확장한다(content-forced.js 가 먼저 세팅).
  var FORCED_MODE = !!window.__hwpForceFullCompat;
  // 수식 위 어디에 올려도 잡히도록 원본 LaTeX 를 담은 래퍼까지 호버 대상에 포함.
  // 디스플레이 수식은 좌우/상하 여백이 넓어 .katex 글리프를 정확히 안 짚으면 놓치므로
  // 바깥 래퍼도 필요하다.
  //  - .katex       : KaTeX 글리프 (모든 사이트 공통)
  //  - [data-math]      : Gemini (span.math-inline / div.math-block)
  //  - [data-math-source]  : ChatGPT (span[role="math"])
  //  - ms-katex       : Google AI Studio (ms-katex.inline / ms-katex.display)
  var HOVER_SELECTOR = FORCED_MODE
    ? '.katex, .katex-display, mjx-container, math, [role="math"], [data-math], [data-math-source], [data-testid="math-container"], [data-testid="math-inline"], [data-testid="math-block"], .math-inline, .math-display, .math-block, ms-katex'
    : '.katex, .katex-display, math, [role="math"], [data-math], [data-math-source], [data-testid="math-container"], [data-testid="math-inline"], [data-testid="math-block"], .math-inline, .math-display, .math-block, ms-katex';

  var API_URL = 'https://hwip.dshs.dev/api/convert';
  var currentKatex = null;
  var hideTimer = null;

  function convert(latex, callback) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex: latex })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { callback(null, data.result || ''); })
    .catch(function(err) { callback(err, ''); });
  }
  function hasAnnotation(el) {
    return !!(el && el.querySelector('annotation[encoding="application/x-tex"]'));
  }
  // 부모 요소에 원본 LaTeX 를 담아두는 사이트들:
  //  - Gemini: data-math
  //  - ChatGPT: data-math-source (role="math" 래퍼) — KaTeX 를 HTML 전용으로 렌더해
  //    <annotation> 노드가 없으므로 이 속성이 유일한 원본 소스다.
  function closestDataMath(el) {
    var cur = el;
    while (cur) {
      if (cur.getAttribute && dataMathValue(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function dataMathValue(el) {
    var keys = ['data-math', 'data-math-source', 'data-formula', 'data-latex', 'data-tex', 'data-expression'];
    for (var i = 0; i < keys.length; i++) {
      var value = el.getAttribute(keys[i]);
      if (value && value.trim()) return value.trim();
    }
    return '';
  }
  function stripMathDelimiters(value) {
    return (value || '').trim()
      .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
      .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
      .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
      .replace(/^\$([\s\S]*)\$$/, '$1')
      .trim();
  }
  function latexFromReactFiber(el) {
    var current = el;
    for (var ancestor = 0; current && ancestor < 7; ancestor++, current = current.parentElement) {
      var keys;
      try { keys = Object.keys(current); } catch (e) { continue; }
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber') !== 0 && keys[i].indexOf('__reactInternalInstance') !== 0) continue;
        var fiber = current[keys[i]];
        for (var depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
          try {
            var props = fiber.memoizedProps;
            if (!props) continue;
            var propKeys = ['math', 'formula', 'tex', 'expression', 'latex', 'value'];
            for (var p = 0; p < propKeys.length; p++) {
              var value = props[propKeys[p]];
              if (typeof value === 'string' && value.trim()) return value.trim();
            }
            if (typeof props.children === 'string' && /[\\{}^_=]/.test(props.children))
              return props.children.trim();
          } catch (e) { /* React 버전에 따라 접근할 수 없는 속성은 건너뜀 */ }
        }
      }
    }
    return '';
  }
  // 강제 모드 또는 알려진 추출 경로가 있으면 true
  function hasExtractable(el) {
    if (!el) return false;
    if (hasAnnotation(el)) return true;
    if (closestDataMath(el)) return true;
    if (latexFromReactFiber(el)) return true;
    if (dataMathValue(el)) return true;
    if (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alttext'))) return true;
    if (!FORCED_MODE) return false;
    if (el.querySelector('script[type="math/tex"], script[type^="math/tex"]')) return true;
    if (el.tagName && el.tagName.toLowerCase() === 'math') return true;
    if (el.querySelector('math')) return true;
    return !!((el.textContent || '').trim());
  }

  // ── 클립보드 복사 (app.js copyText 패턴) ───────────────────────
  function copyText(text, onSuccess) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, legacy);
    } else {
      legacy();
    }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy') && onSuccess) onSuccess();
      } catch (err) { /* 복사 불가 환경 */ }
      document.body.removeChild(ta);
    }
  }

  // ── 공유 버튼 ──────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwp-copy-btn';
  btn.textContent = BTN_LABEL;
  document.documentElement.appendChild(btn);

  function positionRect(rect) {
    var bw = btn.offsetWidth || 64;
    var bh = btn.offsetHeight || 24;
    var left = rect.right - bw + 6;     // 수식 오른쪽 아래 모서리에 살짝 걸치도록
    var top = rect.bottom - 4;
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - bh - 4));
    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
  }

  function showConvert(katex) {
    currentKatex = katex;
    btn.setAttribute('aria-label', hwpMsg('btnCopyHwpAria', '이 수식을 한글(HWP) 수식 문법으로 복사'));
    resetLabel();
    btn.style.display = 'inline-flex';
    positionRect(katex.getBoundingClientRect());
  }
  function hide() { btn.style.display = 'none'; currentKatex = null; }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 220); }
  function cancelHide() { clearTimeout(hideTimer); }

  // 페이지 내 수식 컨테이너들을 문서 순서대로 수집(중첩 <math>는 부모 컨테이너로 흡수).
  // content-forced.js 가 채워둔 window.__hwpRawMathSources[i] 와 같은 인덱스로 매칭한다.
  function collectMathContainers() {
    var nodes = document.querySelectorAll('.katex, mjx-container, math');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      var tag = e.tagName && e.tagName.toLowerCase();
      // KaTeX 출력은 .katex > .katex-mathml > math 구조 — 안쪽 math는 .katex 로 흡수
      if (tag === 'math' && (e.closest('.katex') || e.closest('mjx-container'))) continue;
      out.push(e);
    }
    return out;
  }

  function indexOfContainer(el) {
    var container = (el.closest && (el.closest('.katex') || el.closest('mjx-container'))) ||
                    (el.tagName && el.tagName.toLowerCase() === 'math' ? el : null);
    if (!container) return -1;
    var all = collectMathContainers();
    return all.indexOf(container);
  }

  function extractLatex(el) {
    // 1) Gemini(data-math) / ChatGPT(data-math-source): 부모 요소에 원본 LaTeX 저장
    var dmEl = closestDataMath(el);
    if (dmEl) return stripMathDelimiters(dataMathValue(dmEl));
    // 2) KaTeX/MathJax 공통 — annotation 에 raw LaTeX
    var ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent) return stripMathDelimiters(ann.textContent);
    // 3) ChatGPT의 HTML 전용 KaTeX 렌더는 원문을 React props에만 보관할 수 있다.
    var reactLatex = latexFromReactFiber(el);
    if (reactLatex) return stripMathDelimiters(reactLatex);
    // 4) 최신 ChatGPT/MathML 래퍼의 대체 속성
    var directData = dataMathValue(el);
    if (directData) return stripMathDelimiters(directData);
    var accessible = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alttext'));
    if (accessible) return stripMathDelimiters(accessible);
    // 5) 강제 모드 — MathJax v2 의 <script type="math/tex"> 에 raw LaTeX
    if (FORCED_MODE) {
      var sc = el.querySelector('script[type="math/tex"], script[type^="math/tex"]');
      if (sc && sc.textContent) return sc.textContent.trim();
    }
    // 6) 강제 모드 — content-forced.js 가 받아둔 raw 소스(.md 원문 등)에서 인덱스로 lookup
    if (FORCED_MODE && Array.isArray(window.__hwpRawMathSources) && window.__hwpRawMathSources.length) {
      var idx = indexOfContainer(el);
      if (idx >= 0 && idx < window.__hwpRawMathSources.length) {
        var rec = window.__hwpRawMathSources[idx];
        if (rec && rec.src) return rec.src;
      }
    }
    // 7) MathML <math> textContent
    var mml = (el.tagName && el.tagName.toLowerCase() === 'math') ? el : el.querySelector('math');
    if (mml && mml.textContent) return mml.textContent.trim();
    // 8) 마지막 폴백 — 보이는 텍스트 (시각 문자라 정확도 낮음)
    return (el.textContent || '').trim();
  }

  var labelTimer = null;
  function flash(msg) {
    clearTimeout(labelTimer);
    btn.textContent = msg;
    btn.classList.add('copied');
    labelTimer = setTimeout(resetLabel, 1200);
  }
  function resetLabel() {
    clearTimeout(labelTimer);
    btn.textContent = BTN_LABEL;
    btn.classList.remove('copied');
  }

  // ── 호버 변환 버튼 ─────────────────────────────────────────────
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t === btn) { cancelHide(); return; }
    var el = t.closest(HOVER_SELECTOR);
    // ChatGPT는 원본 LaTeX를 hover 시점보다 늦게 React props에 노출하기도 한다.
    // 버튼 표시를 원문 추출 성공 여부로 막지 않고, 실제 추출은 클릭할 때 수행한다.
    if (el) { cancelHide(); showConvert(el); }
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target;
    if (!t) return;
    if (t === btn || (t.closest && t.closest(HOVER_SELECTOR))) scheduleHide();
  });

  // fixed 좌표가 어긋나므로 스크롤/리사이즈 시 숨김 (다음 호버에서 재계산)
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  // ── 버튼 클릭 ──────────────────────────────────────────────────
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var latex = currentKatex ? extractLatex(currentKatex) : '';
    if (!latex) { flash(hwpMsg('flashNoMath', '수식 없음')); return; }
    flash(hwpMsg('converting', '변환 중…'));
    btn.disabled = true;
    convert(latex, function(err, hwp) {
      btn.disabled = false;
      if (err || !hwp) { flash(hwpMsg('flashFailed', '변환 실패')); return; }
      copyText(hwp, function () { flash(hwpMsg('copied', '복사됨!')); });
    });
  });
  btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  } // end init
})();
