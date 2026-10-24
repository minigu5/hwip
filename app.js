/**
 * 휩 - LaTeX → 한글(HWP) 수식 변환기 웹 앱 메인 로직
 * 
 * Copyright (c) 2026 Shin Mingyu
 * Licensed under Custom License (Non-Commercial & Attribution).
 */
'use strict';

(function () {
  var input = document.getElementById('input');
  var output = document.getElementById('output');
  var preview = document.getElementById('preview');
  var copyBtn = document.getElementById('copyBtn');
  var clearBtn = document.getElementById('clearBtn');
  var copyHint = document.getElementById('copyHint');

  // Modal elements — 렌더링된 수식 경고
  var modal = document.getElementById('warningModal');
  var modalStepWarn = document.getElementById('modalStepWarn');
  var modalStepSolutions = document.getElementById('modalStepSolutions');
  var showSolutionsBtn = document.getElementById('showSolutionsBtn');
  var modalDismissBtn = document.getElementById('modalDismissBtn');
  var modalDoneBtn = document.getElementById('modalDoneBtn');
  var promptCopyBtn = document.getElementById('promptCopyBtn');
  var gotoOcrBtn = document.getElementById('gotoOcrBtn');
  var solutionTabs = modal.querySelectorAll('.solution-tab');
  var solutionPanels = modal.querySelectorAll('.solution-panel');
  var modalDismissTimer = null;

  // Modal elements — $$ 없는 LaTeX 경고
  var noDelimModal = document.getElementById('noDelimiterModal');
  var noDelimDismissBtn = document.getElementById('noDelimDismissBtn');
  var noDelimPromptCopyBtn = document.getElementById('noDelimPromptCopyBtn');
  var NO_DELIM_PROMPT = 'LaTeX 수식은 $$ 기호로 감싸서 다시 작성해줘. 예시 : $$\\nabla \\cdot \\mathbf{u} = 0$$';
  var noDelimDismissTimer = null;
  var noDelimCanClose = false;

  var DEFAULT_HINT = copyHint.textContent;
  var autoCopyTimer = null;
  var hintTimer = null;

  function hideWarningModal() {
    modal.classList.remove('show');
  }

  function hideNoDelimiterModal() {
    if (!noDelimCanClose) return;
    noDelimModal.classList.remove('show');
  }

  // 버튼을 secondsLeft초 동안 잠그고 "n초 후 닫을 수 있어요"를 보여 준 뒤 base 문구로 푼다.
  function lockButtonFor(btn, base, secondsLeft, prevTimer, onUnlock) {
    clearInterval(prevTimer);
    btn.disabled = true;
    btn.textContent = secondsLeft + '초 후 닫을 수 있어요';
    var timer = setInterval(function () {
      secondsLeft--;
      if (secondsLeft > 0) {
        btn.textContent = secondsLeft + '초 후 닫을 수 있어요';
      } else {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = base;
        if (onUnlock) onUnlock();
      }
    }, 1000);
    return timer;
  }

  // 복사 성공 시 버튼 문구를 잠깐 "복사됨"으로 바꾼다 (연타해도 원래 문구를 잃지 않게 dataset에 보관).
  function flashCopied(btn) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = '복사됨';
    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(function () { btn.textContent = btn.dataset.label; }, 1200);
  }

  function showNoDelimiterModal() {
    noDelimCanClose = false;
    noDelimModal.classList.add('show');

    // 남은 시간을 줄어드는 막대로도 보여 준다 (클래스를 뗐다 붙여 애니메이션 재시작)
    var drain = document.getElementById('noDelimDrain');
    if (drain) {
      drain.classList.remove('run');
      void drain.offsetWidth;
      drain.classList.add('run');
    }
    noDelimDismissTimer = lockButtonFor(noDelimDismissBtn, '변환 결과 그대로 쓰기', 2, noDelimDismissTimer, function () {
      noDelimCanClose = true;
    });
  }

  function showModalStep(step) {
    var solutions = step === 'solutions';
    modalStepWarn.hidden = solutions;
    modalStepSolutions.hidden = !solutions;
  }

  function selectSolution(n) {
    for (var i = 0; i < solutionTabs.length; i++) {
      var active = solutionTabs[i].getAttribute('data-sol') === n;
      solutionTabs[i].classList.toggle('active', active);
      solutionTabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (var j = 0; j < solutionPanels.length; j++) {
      solutionPanels[j].hidden = solutionPanels[j].getAttribute('data-sol') !== n;
    }
  }

  function showWarningModal() {
    showModalStep('warn');
    selectSolution('1');
    renderWarnExample();
    modal.classList.add('show');

    // 경고를 읽도록 '그냥 닫기'만 2초간 비활성화 (해결 방안 보기는 즉시 가능)
    modalDismissTimer = lockButtonFor(modalDismissBtn, '그냥 닫기', 2, modalDismissTimer);
  }

  // 경고 모달의 "원래 수식" 예시를 KaTeX로 그린다 (로딩 전이면 유니코드 문구 그대로 둔다)
  var warnExampleRendered = false;
  function renderWarnExample() {
    var el = document.getElementById('warnExampleMath');
    if (warnExampleRendered || !el || typeof katex === 'undefined') return;
    try {
      katex.render('x^2+y^2=r^2', el, { throwOnError: false });
      warnExampleRendered = true;
    } catch (e) { /* 예시는 장식이므로 실패해도 문구를 남긴다 */ }
  }

  showSolutionsBtn.addEventListener('click', function () { showModalStep('solutions'); });
  modalDismissBtn.addEventListener('click', hideWarningModal);
  modalDoneBtn.addEventListener('click', hideWarningModal);

  noDelimDismissBtn.addEventListener('click', hideNoDelimiterModal);
  noDelimModal.addEventListener('click', function (e) {
    if (e.target === noDelimModal) hideNoDelimiterModal();
  });

  if (noDelimPromptCopyBtn) {
    noDelimPromptCopyBtn.addEventListener('click', function () {
      copyText(NO_DELIM_PROMPT, function () { flashCopied(noDelimPromptCopyBtn); });
    });
  }

  for (var ti = 0; ti < solutionTabs.length; ti++) {
    (function (tab) {
      tab.addEventListener('click', function () { selectSolution(tab.getAttribute('data-sol')); });
    })(solutionTabs[ti]);
  }

  // 방안 2: 이미지 인식 열기 (모달 닫고 입력창으로 스크롤 후 파일 피커 열기)
  if (gotoOcrBtn) {
    gotoOcrBtn.addEventListener('click', function () {
      hideWarningModal();
      var wrap = document.getElementById('inputWrap');
      if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var imgInput = document.getElementById('imageInput');
      if (imgInput) imgInput.click();
    });
  }

  if (promptCopyBtn) {
    promptCopyBtn.addEventListener('click', function () {
      copyText("답변에서 수식은 렌더링 하지 말고 순수 LaTeX 코드로 작성해 줘.\n복사 가능하도록 latex 코드 블록을 사용해 줘.", function () {
        flashCopied(promptCopyBtn);
      });
    });
  }
  
  // Also close modal when clicking outside the content
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      hideWarningModal();
    }
  });

  // Heuristic to detect if pasted text is likely rendered math instead of LaTeX
  function isLikelyRenderedMath(text) {
    if (!text || text.trim().length === 0) return false;
    
    // Count occurrences of common LaTeX indicators
    var latexMarkers = (text.match(/[\^_\\{}]/g) || []).length;
    
    // Count occurrences of unicode math symbols that are usually macros in LaTeX
    var unicodeMathMarkers = (text.match(/[∫∑∂∞≈≠≡≤≥αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ]/g) || []).length;
    
    // If it has very few LaTeX markers but has unicode math symbols, it's likely rendered.
    // Also, rendered text from AI often contains invisible characters like zero-width spaces (\u200B)
    var hasInvisibleChars = /\u200B/.test(text);
    
    if (hasInvisibleChars && latexMarkers === 0) return true;
    
    // If text is somewhat long, has unicode math, but almost no latex structural characters
    if (text.length > 10 && unicodeMathMarkers > 0 && latexMarkers <= 1) {
      return true;
    }
    
    return false;
  }

  // $$ / $ / \[ / \( 구분자 없이 LaTeX 명령(\frac, \mu 등)이 있는지 감지
  function isLikelyUndelimitedLatex(text) {
    if (!text || text.trim().length === 0) return false;
    var t = text.trim();
    if (/^\$\$/.test(t) || /^\$/.test(t) || /^\\\[/.test(t) || /^\\\(/.test(t)) return false;
    return /\\[a-zA-Z]{2,}/.test(t);
  }

  var isPasting = false;
  input.addEventListener('paste', function() {
    isPasting = true;
  });

  var UNICODE_TO_HWP = {
    '∫': 'int ', '∬': 'dint ', '∭': 'tint ', '∮': 'oint ',
    '∑': 'sum ', '∏': 'prod ', '∂': 'partial ', '∞': 'inf ',
    '≈': 'approx ', '≠': '!= ', '≡': 'equiv ', '≤': '<= ', '≥': '>= ',
    'α': 'alpha ', 'β': 'beta ', 'γ': 'gamma ', 'δ': 'delta ', 'ε': 'epsilon ',
    'ζ': 'zeta ', 'η': 'eta ', 'θ': 'theta ', 'ι': 'iota ', 'κ': 'kappa ',
    'λ': 'lambda ', 'μ': 'mu ', 'ν': 'nu ', 'ξ': 'xi ', 'π': 'pi ',
    'ρ': 'rho ', 'σ': 'sigma ', 'τ': 'tau ', 'υ': 'upsilon ', 'φ': 'phi ',
    'χ': 'chi ', 'ψ': 'psi ', 'ω': 'omega ',
    'Γ': 'Gamma ', 'Δ': 'Delta ', 'Θ': 'Theta ', 'Λ': 'Lambda ', 'Ξ': 'Xi ',
    'Π': 'Pi ', 'Σ': 'Sigma ', 'Υ': 'Upsilon ', 'Φ': 'Phi ', 'Ψ': 'Psi ', 'Ω': 'Omega ',
    '→': '-> ', '←': '<- ', '↑': 'uparrow ', '↓': 'downarrow ', '↔': '<-> ',
    '−': '- ', '×': 'times ', '÷': 'div ', '±': '+- ', '√': 'sqrt ', '∝': 'propto ',
    '∈': 'in ', '∉': 'notin ', '∪': 'union ', '∩': 'inter ', '⊂': 'subset ',
    '⊃': 'supset ', '⊆': 'subseteq ', '⊇': 'supseteq ', '⋅': 'BULLET '
  };

  function fallbackConvert(text) {
    var isGAS = /\u200B/.test(text);
    
    // Claude flat text heuristic
    if (!isGAS && !/\n/.test(text) && text.indexOf('=') !== -1) {
      // Subscript heuristics
      text = text.replace(/([A-ZΑ-Ω])([a-zA-Z])/g, '$1_{$2}');
      text = text.replace(/([a-zA-Zα-ωΑ-Ω])([0-9])/g, '$1_{$2}');
      
      // Fraction heuristics (Denominator comes before Numerator in some flat copies)
      text = text.replace(/dt(d[a-zA-Zα-ωΑ-Ω](?:_\{[a-zA-Z]\})?)/g, '{$1} over {dt}');
      text = text.replace(/(ε_\{0\})1/g, '{1} over {$1}');
    }

    // Replace unicodes with HWP keywords
    var converted = text.split('').map(function(c) {
      return UNICODE_TO_HWP[c] || c;
    }).join('');

    if (isGAS) {
      // GAS: try to format `A \n B \n \u200b` as `{B}_{A}` to loosely group fractions/scripts
      converted = converted.replace(/([^\n]+)\n([^\n]+)\n\u200B\n?/g, function(match, p1, p2) {
        return '{' + p2.trim() + '}_{' + p1.trim() + '} ';
      });
      converted = converted.replace(/\u200B/g, ' ').replace(/\n/g, ' ');
      converted = converted.replace(/\s+/g, ' ').trim();
      return { source: "Google AI Studio", text: converted };
    } else {
      // Claude / ChatGPT flat text
      converted = converted.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      return { source: "Claude/ChatGPT", text: converted };
    }
  }

  // 입력에서 수식 구분자($$, $, \[ \], \( \))를 제거 (미리보기용)
  function stripDelimiters(s) {
    s = s.trim();
    s = s.replace(/^\$\$/, '').replace(/\$\$$/, '');
    s = s.replace(/^\$/, '').replace(/\$$/, '');
    s = s.replace(/^\\\[/, '').replace(/\\\]$/, '');
    s = s.replace(/^\\\(/, '').replace(/\\\)$/, '');
    return s.trim();
  }

  function flashHint(message) {
    clearTimeout(hintTimer);
    copyHint.textContent = message;
    copyHint.classList.add('copied');
    hintTimer = setTimeout(function () {
      copyHint.textContent = DEFAULT_HINT;
      copyHint.classList.remove('copied');
    }, 1600);
  }

  function copyText(text, onSuccess) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy') && onSuccess) onSuccess();
      } catch (e) { /* 클립보드 접근 불가(예: file://) — 복사 버튼으로 직접 복사 */ }
      document.body.removeChild(ta);
    }
  }

  var previewPanel = document.getElementById('previewPanel');
  function setPreviewVisible(visible) {
    if (previewPanel) previewPanel.hidden = !visible;
  }

  function renderPreview(latex) {
    if (!latex) { setPreviewVisible(false); return; }

    var body = latex.trim();
    body = body.replace(/\\fras(?=[^a-zA-Z]|$)/g, '\\frac');
    body = body.replace(/\\overset\s*{\s*!\s*}\s*{\s*`?=`?\s*}/g, '\\neq');
    // `\[A\] \[B\]` 처럼 수식 블록이 여러 개면 블록별로 따로 렌더한다.
    // 통째로 넘기면 가운데 남은 `\]`·`\[` 때문에 KaTeX 가 렌더 오류를 낸다.
    var blocks = splitMathBlocks(body);
    if (!blocks.length) blocks = [stripDelimiters(body)];
    blocks = blocks.filter(function (b) { return b; });

    if (!blocks.length) { setPreviewVisible(false); return; }

    setPreviewVisible(true);
    if (typeof katex === 'undefined') {
      preview.innerHTML = '<span class="placeholder">렌더러 로딩 중…</span>';
      return;
    }
    preview.innerHTML = '';
    blocks.forEach(function (b) {
      var el = document.createElement('div');
      el.className = 'preview-block';
      try {
        katex.render(b, el, { displayMode: true, throwOnError: false });
      } catch (e) {
        el.innerHTML = '<span class="render-error">렌더 오류: ' + (e.message || e) + '</span>';
      }
      preview.appendChild(el);
    });
  }

  // `$$…$$`, `\[…\]`, `\(…\)` 수식 블록 본문만 뽑는다. `\\[8pt]` 처럼
  // 백슬래시로 이스케이프된 문자는 두 글자씩 건너뛰어 구분자로 오인하지 않는다.
  function splitMathBlocks(s) {
    var out = [], start = -1, close = null, i = 0;
    while (i < s.length) {
      var c = s[i], n = s[i + 1];
      if (close === null) {
        if (c === '$' && n === '$') { close = '$$'; start = i + 2; i += 2; continue; }
        if (c === '\\' && (n === '[' || n === '(')) {
          close = n === '[' ? '\\]' : '\\)'; start = i + 2; i += 2; continue;
        }
        i += c === '\\' ? 2 : 1;
      } else {
        if (s.substr(i, 2) === close) { out.push(s.slice(start, i).trim()); close = null; i += 2; continue; }
        i += c === '\\' ? 2 : 1;
      }
    }
    return out;
  }

  // 한글 수식 출력을 토큰별 span으로 그린다. 구조 명령(over, LEFT…)·첨자 묶음·
  // 좁은 공백(`)·일반 공백(~)을 구분해 보여 주며, textContent는 원문 그대로라 복사에 영향이 없다.
  var HWP_KEYWORDS = {
    over: 1, atop: 1, sqrt: 1, root: 1, of: 1, LEFT: 1, RIGHT: 1, sum: 1, prod: 1, int: 1, dint: 1, tint: 1,
    oint: 1, lim: 1, matrix: 1, pmatrix: 1, bmatrix: 1, dmatrix: 1, cases: 1, pile: 1, lpile: 1, rpile: 1,
    rm: 1, it: 1, bold: 1, hat: 1, bar: 1, vec: 1, dot: 1, ddot: 1, tilde: 1, under: 1, overline: 1, underline: 1
  };
  var HWP_GREEK = /^(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/;

  function setHwpOutput(text) {
    output.textContent = '';
    if (!text) return;
    var frag = document.createDocumentFragment();
    text.split(/(`|~|[{}_^]|\s+|[A-Za-z]+)/).forEach(function (s) {
      if (!s) return;
      var cls = null;
      if (s === '`' || s === '~') cls = 'sp';
      else if (s === '{' || s === '}' || s === '_' || s === '^') cls = 'tk-mute';
      else if (HWP_KEYWORDS[s]) cls = 'tk-kw';
      else if (HWP_GREEK.test(s)) cls = 'tk-greek';
      if (!cls) { frag.appendChild(document.createTextNode(s)); return; }
      var span = document.createElement('span');
      span.className = cls;
      span.textContent = s;
      frag.appendChild(span);
    });
    output.appendChild(frag);
  }

  // 공백 기호(`, ~) 강조 체크박스 — 기본은 꺼짐, 선택값은 브라우저에 기억한다.
  var spaceToggle = document.getElementById('spaceToggle');
  if (spaceToggle) {
    try { spaceToggle.checked = localStorage.getItem('showSpaces') === 'true'; } catch (e) {}
    output.classList.toggle('show-spaces', spaceToggle.checked);
    spaceToggle.addEventListener('change', function () {
      output.classList.toggle('show-spaces', spaceToggle.checked);
      try { localStorage.setItem('showSpaces', spaceToggle.checked ? 'true' : 'false'); } catch (e) {}
    });
  }

  function render() {
    var val = input.value;
    var isRendered = isLikelyRenderedMath(val);
    var isUndelimited = !isRendered && isLikelyUndelimitedLatex(val);

    if (isRendered) {
      if (isPasting) {
        showWarningModal();
      }
      var fallback = fallbackConvert(val);
      output.textContent = fallback.text;
      output.setAttribute('data-warning', "/* " + fallback.source + " 복구 (불완전 - 위/아래 첨자 수동 수정 필요) */");
      output.classList.add('fallback-mode'); // 주황 글씨로 불완전 복구임을 표시
      renderPreview(val);
      clearTimeout(autoCopyTimer);
    } else {
      output.removeAttribute('data-warning');
      output.classList.remove('fallback-mode');
      var result = window.LatexToHwp.convert(val);
      setHwpOutput(result);
      renderPreview(val);

      if (isUndelimited && isPasting) {
        showNoDelimiterModal();
      }

      // 변환되면 자동으로 클립보드에 복사 (입력이 멈춘 뒤)
      clearTimeout(autoCopyTimer);
      if (result) {
        autoCopyTimer = setTimeout(function () {
          copyText(result, function () { flashHint('클립보드에 복사됨'); });
        }, 450);
      }
    }
    isPasting = false;
  }

  input.addEventListener('input', render);

  clearBtn.addEventListener('click', function () {
    input.value = '';
    render();
    input.focus();
    var ocrRow = document.getElementById('ocrRow');
    if (ocrRow) ocrRow.style.display = 'none';
    setOcrStatus('', '');
    if (ocrPreviewImg) ocrPreviewImg.src = '';
    if (lastPreviewUrl) { URL.revokeObjectURL(lastPreviewUrl); lastPreviewUrl = null; }
  });

  copyBtn.addEventListener('click', function () {
    copyText(output.textContent, function () { flashCopied(copyBtn); });
  });

  // ── 이미지 OCR (브라우저 로컬 · FormulaNet via transformers.js) ───────
  // 이미지 → (전처리) → 워커에서 모델 추론 → LaTeX → 기존 입력창에 넣어
  // 기존 클라이언트 변환 흐름(render)을 그대로 태운다. 서버는 쓰지 않는다.

  var imageInput = document.getElementById('imageInput');
  var pickImageBtn = document.getElementById('pickImageBtn');
  var ocrStatus = document.getElementById('ocrStatus');
  var ocrPreviewImg = document.getElementById('ocrPreviewImg');
  var inputWrap = document.getElementById('inputWrap');

  var OCR_SIZE = 384;
  // UniMERNet 전처리 정규화 상수 (FormulaNet 학습 기준)
  var UNIMER_MEAN = 0.7931;
  var UNIMER_STD = 0.1738;

  var TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';
  var OCR_MODEL = 'alephpi/FormulaNet';

  var ocrEngine = null;       // Promise → { predict(Float32Array) → Promise<string> }
  var lastPreviewUrl = null;

  function setOcrStatus(html, cls) {
    if (!ocrStatus) return;
    ocrStatus.className = 'ocr-status' + (cls ? ' ' + cls : '');
    ocrStatus.innerHTML = html;
  }

  function renderOcrProgress(p) {
    if (!p) return;
    if (p.status === 'progress') {
      var pct = (typeof p.progress === 'number') ? Math.round(p.progress)
        : (p.total ? Math.round((p.loaded / p.total) * 100) : null);
      if (pct === null) { setOcrStatus('AI 모델 내려받는 중…', 'busy'); return; }
      if (pct > 100) pct = 100;
      setOcrStatus('AI 모델 다운로드 중… ' + pct +
        '% <span class="ocr-progress"><i style="width:' + pct + '%"></i></span>', 'busy');
    } else if (p.status === 'initiate' || p.status === 'download') {
      setOcrStatus('AI 모델 내려받는 중… (최초 1회)', 'busy');
    }
  }

  function ocrUid() {
    return (self.crypto && crypto.randomUUID)
      ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  // (1순위) 별도 스레드 워커 엔진. 모델 로딩이 끝나면 { predict } 로 resolve.
  // 워커 생성 자체가 막히는 환경(file:// 직접 열기, 모듈 워커 미지원)에서는 reject 한다.
  function createWorkerEngine() {
    return new Promise(function (resolve, reject) {
      var worker;
      try {
        worker = new Worker('src/ocr-worker.js', { type: 'module' });
      } catch (e) {
        reject(e); return;
      }
      var ready = false;
      var pending = {};
      worker.onmessage = function (e) {
        var m = e.data || {};
        if (m.status === 'progress') {
          renderOcrProgress(m.data);
        } else if (m.status === 'ready') {
          ready = true;
          resolve({
            predict: function (arr) {
              return new Promise(function (res, rej) {
                var key = ocrUid();
                pending[key] = { res: res, rej: rej };
                worker.postMessage({ action: 'predict', array: arr, key: key }, [arr.buffer]);
              });
            }
          });
        } else if (m.status === 'result') {
          if (pending[m.key]) { pending[m.key].res(m.text); delete pending[m.key]; }
        } else if (m.status === 'error') {
          if (m.key && pending[m.key]) { pending[m.key].rej(new Error(m.error)); delete pending[m.key]; }
          else if (!ready) { reject(new Error(m.error || '모델 로딩 실패')); }
        }
      };
      worker.onerror = function (ev) {
        if (!ready) reject(new Error(ev.message || '워커 로딩 실패'));
      };
      worker.postMessage({ action: 'init' });
    });
  }

  // (폴백) 메인 스레드 엔진. transformers.js를 동적 import 해 직접 추론한다.
  // 워커를 못 쓰는 환경에서도 동작한다(추론 중 잠시 UI가 멈출 수 있음).
  function createMainThreadEngine() {
    setOcrStatus('AI 모델 준비 중… (호환 모드)', 'busy');
    return import(TF_CDN).then(function (tf) {
      tf.env.allowLocalModels = false;
      return tf.VisionEncoderDecoderModel.from_pretrained(OCR_MODEL, {
        dtype: 'fp32',
        progress_callback: function (data) { renderOcrProgress(data); }
      }).then(function (model) {
        return tf.PreTrainedTokenizer.from_pretrained(OCR_MODEL).then(function (tokenizer) {
          return {
            predict: function (arr) {
              var single = new tf.Tensor('float32', arr, [1, 1, OCR_SIZE, OCR_SIZE]);
              var pixel = tf.cat([single, single, single], 1);
              return Promise.resolve(model.generate({ inputs: pixel })).then(function (outputs) {
                return tokenizer.batch_decode(outputs, { skip_special_tokens: true })[0];
              });
            }
          };
        });
      });
    });
  }

  // 엔진을 한 번만 만든다. 워커가 안 되면 메인 스레드로 자동 폴백.
  function ensureOcrEngine() {
    if (ocrEngine) return ocrEngine;
    ocrEngine = createWorkerEngine().catch(function () {
      return createMainThreadEngine();
    });
    return ocrEngine;
  }

  // 이미지를 모델 입력 형태(384x384 그레이스케일 Float32Array)로 전처리한다.
  // 단계: 흰 배경 합성 → 그레이스케일 → (어두운 이미지면) 색 반전 → 여백 크롭
  //       → 비율 유지 축소 + 중앙 패딩 → 정규화. (Texo-web/UniMERNet 전처리와 동일)
  function preprocessImage(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var W = bmp.width, H = bmp.height;
      var base = document.createElement('canvas');
      base.width = W; base.height = H;
      var bx = base.getContext('2d', { willReadFrequently: true });
      bx.fillStyle = '#fff';
      bx.fillRect(0, 0, W, H);          // 투명 배경을 흰색으로
      bx.drawImage(bmp, 0, 0);
      var rgba = bx.getImageData(0, 0, W, H).data;

      // 그레이스케일 (Rec.601 luma — PIL 'L' 변환과 동일)
      var grey = new Uint8ClampedArray(W * H);
      for (var i = 0, p = 0; i < grey.length; i++, p += 4) {
        grey[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) | 0;
      }

      // 색 반전 휴리스틱: 어두운 픽셀이 더 많으면(흰 글씨/검은 배경) 반전해 흑자/백지로
      var hist = new Array(256);
      for (var h = 0; h < 256; h++) hist[h] = 0;
      for (var g = 0; g < grey.length; g++) hist[grey[g]]++;
      var dark = 0, light = 0;
      for (var v = 0; v < 200; v++) dark += hist[v];
      for (var w = 200; w < 256; w++) light += hist[w];
      if (dark >= light) {
        for (var r = 0; r < grey.length; r++) grey[r] = 255 - grey[r];
      }

      // 여백 크롭: 정규화 값 < 200 인 픽셀(=내용)의 경계 상자
      var mn = 255, mx = 0;
      for (var a = 0; a < grey.length; a++) { if (grey[a] < mn) mn = grey[a]; if (grey[a] > mx) mx = grey[a]; }
      var cropX = 0, cropY = 0, cropW = W, cropH = H;
      if (mx !== mn) {
        var minX = W, minY = H, maxX = 0, maxY = 0, found = false;
        var range = mx - mn;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var nrm = ((grey[y * W + x] - mn) / range) * 255;
            if (nrm < 200) {
              found = true;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (found && maxX >= minX && maxY >= minY) {
          cropX = minX; cropY = minY;
          cropW = Math.max(1, maxX - minX);
          cropH = Math.max(1, maxY - minY);
        }
      }

      // 크롭 영역을 캔버스에 그린다
      var crop = document.createElement('canvas');
      crop.width = cropW; crop.height = cropH;
      var cx = crop.getContext('2d');
      var cropData = cx.createImageData(cropW, cropH);
      for (var cy = 0; cy < cropH; cy++) {
        for (var cxp = 0; cxp < cropW; cxp++) {
          var gv = grey[(cropY + cy) * W + (cropX + cxp)];
          var di = (cy * cropW + cxp) * 4;
          cropData.data[di] = cropData.data[di + 1] = cropData.data[di + 2] = gv;
          cropData.data[di + 3] = 255;
        }
      }
      cx.putImageData(cropData, 0, 0);

      // 384x384 안에 비율 유지로 축소 후 중앙 배치 (나머지는 0=검정 패딩)
      var scale = OCR_SIZE / Math.min(cropH, cropW);
      var newW = Math.round(cropW * scale), newH = Math.round(cropH * scale);
      if (newW > OCR_SIZE || newH > OCR_SIZE) {
        var ratio = Math.min(OCR_SIZE / newW, OCR_SIZE / newH);
        newW = Math.round(newW * ratio); newH = Math.round(newH * ratio);
      }
      newW = Math.max(1, newW); newH = Math.max(1, newH);
      var padW = Math.floor((OCR_SIZE - newW) / 2);
      var padH = Math.floor((OCR_SIZE - newH) / 2);

      var fin = document.createElement('canvas');
      fin.width = OCR_SIZE; fin.height = OCR_SIZE;
      var fx = fin.getContext('2d', { willReadFrequently: true });
      fx.fillStyle = '#000';
      fx.fillRect(0, 0, OCR_SIZE, OCR_SIZE);
      fx.imageSmoothingEnabled = true;
      fx.imageSmoothingQuality = 'high';
      fx.drawImage(crop, padW, padH, newW, newH);
      var finData = fx.getImageData(0, 0, OCR_SIZE, OCR_SIZE).data;

      var arr = new Float32Array(OCR_SIZE * OCR_SIZE);
      for (var k = 0, q = 0; k < arr.length; k++, q += 4) {
        arr[k] = (finData[q] / 255 - UNIMER_MEAN) / UNIMER_STD; // R채널 = grey
      }
      return arr;
    });
  }

  function runOcr(blob) {
    if (!blob) return;

    var ocrRow = document.getElementById('ocrRow');
    if (ocrRow) ocrRow.style.display = 'flex';

    if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
    lastPreviewUrl = URL.createObjectURL(blob);
    if (ocrPreviewImg) ocrPreviewImg.src = lastPreviewUrl;

    setOcrStatus('AI 모델 준비 중… (최초 1회는 다운로드로 시간이 걸릴 수 있어요)', 'busy');

    // 모델 로딩과 이미지 전처리를 동시에 진행
    var pre = preprocessImage(blob);
    ensureOcrEngine()
      .then(function (engine) {
        setOcrStatus('수식 인식 중…', 'busy');
        return pre.then(function (arr) { return engine.predict(arr); });
      })
      .then(function (latex) {
        latex = (latex || '').trim();
        if (!latex) {
          setOcrStatus('수식을 찾지 못했어요. 더 또렷하고 여백이 적은 이미지로 다시 시도해 보세요.', 'error');
          return;
        }
        input.value = '$$' + latex + '$$';
        isPasting = false; // OCR 결과는 정상 LaTeX이므로 경고 모달을 띄우지 않음
        render();
        setOcrStatus('인식 완료 ✓ 아래에서 결과를 확인·수정하세요.', '');
      })
      .catch(function (err) {
        setOcrStatus('인식 실패: ' + ((err && err.message) ? err.message : err), 'error');
      });
  }

  if (pickImageBtn) {
    pickImageBtn.addEventListener('click', function () {
      if (imageInput) imageInput.click();
    });
  }

  if (inputWrap) {
    inputWrap.addEventListener('dragover', function (e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      var hasFiles = types && [].indexOf.call(types, 'Files') !== -1;
      if (hasFiles) {
        e.preventDefault();
        inputWrap.classList.add('dragover');
      }
    });
    inputWrap.addEventListener('dragleave', function (e) {
      if (!inputWrap.contains(e.relatedTarget)) {
        inputWrap.classList.remove('dragover');
      }
    });
    inputWrap.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) {
        e.preventDefault();
        inputWrap.classList.remove('dragover');
        runOcr(f);
      } else {
        inputWrap.classList.remove('dragover');
      }
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', function () {
      var f = imageInput.files && imageInput.files[0];
      if (f) runOcr(f);
      imageInput.value = ''; // 같은 파일 재선택 허용
    });
  }

  // 페이지 어디서든 이미지 붙여넣기를 OCR 입력으로 받는다 (텍스트 붙여넣기는 그대로)
  document.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    var hasText = false;
    var imageBlob = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type === 'text/plain') hasText = true;
      else if (!imageBlob && items[i].type && items[i].type.indexOf('image') === 0) {
        imageBlob = items[i].getAsFile();
      }
    }

    // 파일 탭이 활성화된 상태에서 텍스트 붙여넣기 → 마크다운으로 처리
    var fileTabPanel = document.getElementById('tabFile');
    if (hasText && fileTabPanel && fileTabPanel.classList.contains('active')) {
      var pastedText = e.clipboardData.getData('text/plain');
      if (pastedText.trim()) {
        e.preventDefault();
        currentMdText = pastedText;
        currentMdFileName = null;
        showMdSections(true);
        applyMdDocStyle();
        renderMdPreview();
        showDocSettings(true);
        if (fileNameInput && !fileNameInput.value.trim()) {
          var pastedTitle = extractMdTitle(pastedText);
          if (pastedTitle) fileNameInput.value = pastedTitle;
        }
        if (mdDownloadBtn) {
          mdDownloadBtn.disabled = false;
          mdDownloadBtn.textContent = 'HWPX 내려받기';
        }
        clearFileResult();
        var lineCount = pastedText.split('\n').length;
        showFileCard(fileCardHtml('MD', '붙여넣은 마크다운', lineCount + '줄을 불러왔습니다. 설정과 미리보기를 확인한 뒤 내려받으세요', ''), true);
      }
      return;
    }

    // HWP 등 서식 있는 텍스트 복사 시 이미지도 함께 포함되므로,
    // text/plain이 있으면 이미지 OCR을 건너뛴다.
    if (hasText) {
      if (document.activeElement !== input) {
        // 입력 필드 밖에서 붙여넣기 → 서식 제거 후 입력에 삽입
        var text = e.clipboardData.getData('text/plain');
        if (text.trim()) {
          e.preventDefault();
          input.value = text;
          isPasting = true;
          input.dispatchEvent(new Event('input'));
          input.focus();
        }
      }
      // 입력 필드에 포커스 중이면 브라우저 기본 동작(plain text 삽입)에 맡긴다
      return;
    }

    if (imageBlob) {
      e.preventDefault();
      runOcr(imageBlob);
    }
  });

  render();

  // ── 탭 전환 ──────────────────────────────────────────────────────────────
  var tabTextBtn = document.getElementById('tabTextBtn');
  var tabFileBtn = document.getElementById('tabFileBtn');
  var tabTextPanel = document.getElementById('tabText');
  var tabFilePanel = document.getElementById('tabFile');

  function activateTab(which) {
    var isFile = which === 'file';
    tabTextBtn.classList.toggle('active', !isFile);
    tabFileBtn.classList.toggle('active', isFile);
    tabTextBtn.setAttribute('aria-selected', isFile ? 'false' : 'true');
    tabFileBtn.setAttribute('aria-selected', isFile ? 'true' : 'false');
    tabTextPanel.classList.toggle('active', !isFile);
    tabFilePanel.classList.toggle('active', isFile);
    // 문서 변환은 설정·미리보기 2열이라 페이지 폭을 넓히고, 제목·푸터 문구를 탭에 맞춘다
    var pageWrap = document.getElementById('pageWrap');
    if (pageWrap) pageWrap.classList.toggle('wide', isFile);
    [['heroText', !isFile], ['heroFile', isFile], ['footerText', !isFile], ['footerFile', isFile]].forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (el) el.hidden = !p[1];
    });
  }

  if (tabTextBtn) tabTextBtn.addEventListener('click', function () { activateTab('text'); });
  if (tabFileBtn) tabFileBtn.addEventListener('click', function () { activateTab('file'); });

  // ── 파일 변환 (HWP / HWPX → 수식 개체 삽입) ──────────────────────────────
  var fileDrop = document.getElementById('fileDrop');
  var fileInputEl = document.getElementById('fileInput');
  var pickFileBtn = document.getElementById('pickFileBtn');
  var fileResultEl = document.getElementById('fileResult');
  var hwpConvertingNote = document.getElementById('hwpConvertingNote');
  var fileNameInput = document.getElementById('fileNameInput');
  var mdFontOptions = document.getElementById('mdFontOptions');

  var fileResultUrl = null;

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clearFileResult() {
    if (fileResultUrl) { URL.revokeObjectURL(fileResultUrl); fileResultUrl = null; }
    fileResultEl.innerHTML = '';
    fileResultEl.style.display = 'none';
  }

  // 불러온 파일 카드: 확장자 배지 + 파일명 + 한 줄 설명. kind = '' | 'warn' | 'err'
  function fileCardHtml(ext, name, meta, kind) {
    return '<div class="file-card' + (kind ? ' ' + kind : '') + '">' +
      '<span class="file-ext">' + ext + '</span>' +
      '<div class="file-card-body">' +
        '<div class="file-card-name">' + escHtml(name) + '</div>' +
        (meta ? '<div class="file-card-meta">' + escHtml(meta) + '</div>' : '') +
      '</div></div>';
  }

  function extBadge(filename) {
    var m = /\.([a-z0-9]+)$/i.exec(filename || '');
    return m ? escHtml(m[1].toUpperCase().slice(0, 5)) : 'FILE';
  }

  // 결과 카드를 보여 주고, 파일이 올라간 뒤에는 드롭 영역을 한 줄로 줄인다
  function showFileCard(html, compactDrop) {
    fileResultEl.innerHTML = html;
    fileResultEl.style.display = 'block';
    if (fileDrop) fileDrop.classList.toggle('compact', !!compactDrop);
  }

  function showFileError(msg) {
    showFileCard(fileCardHtml('!', msg, '', 'err'), false);
  }

  function showFileResult(blob, stats, filename) {
    if (fileResultUrl) URL.revokeObjectURL(fileResultUrl);
    fileResultUrl = URL.createObjectURL(blob);

    var forcedEq = stats.forcedEquations || 0;
    var normalEq = stats.equations - forcedEq;
    var hasAny = stats.equations > 0;

    var metaParts = [];
    if (normalEq > 0) metaParts.push('수식 ' + normalEq + '개 변환');
    if (forcedEq > 0) metaParts.push('강제 변환 ' + forcedEq + '개');
    if (stats.sectionsChanged > 0) metaParts.push('섹션 ' + stats.sectionsChanged + '개 수정');
    if (stats.skippedNumericDollars > 0) metaParts.push('금액 ' + stats.skippedNumericDollars + '개 유지');

    var html = '';
    if (hasAny) {
      var kind = (forcedEq > 0 && normalEq === 0) ? 'warn' : '';
      html += fileCardHtml(extBadge(filename), filename, metaParts.join(', '), kind);
      html += '<a class="dl-btn" href="' + fileResultUrl + '" download="' + escHtml(filename) + '">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>' +
        '변환된 파일 내려받기</a>';
    } else {
      html += fileCardHtml(extBadge(filename), filename, '변환할 LaTeX 수식을 찾지 못했습니다', 'warn');
    }

    showFileCard(html, true);

    if (forcedEq > 0) {
      showNoDelimiterModal();
    }
  }

  function runFileConvert(file) {
    if (!file) return;
    clearFileResult();

    var isHwpx = /\.hwpx$/i.test(file.name);
    var isHwp = /\.hwp$/i.test(file.name) && !isHwpx;

    showFileCard(fileCardHtml('<span class="conv-spinner"></span>', file.name, '변환 중…', ''), true);

    var convertPromise = isHwp
      ? convertHwpViaRhwp(file)
      : convertHwpx(file);

    convertPromise
      .then(function (out) {
        showFileResult(out.blob, out.stats, out.filename);
        // 변환 결과의 제목/파일명을 입력창에 반영 (사용자가 직접 입력하지 않은 경우만)
        if (fileNameInput && !getFileNameInputValue() && out.title) {
          fileNameInput.value = out.title;
        }
      })
      .catch(function (err) { showFileError((err && err.message) ? err.message : String(err)); });
  }

  function getFileNameInputValue() {
    return fileNameInput ? fileNameInput.value.trim() : '';
  }

  // HWPX 직접 변환 (hwpx-convert.js 사용)
  function convertHwpx(file) {
    var customName = getFileNameInputValue();
    return window.HwpxConvert.convertFile(file, null, customName ? { outputName: customName } : undefined);
  }

  // HWP 이진 파일: rhwp editor iframe을 숨겨서 HWPX로 변환 후 처리
  function convertHwpViaRhwp(file) {
    var RHWP_URL = 'https://edwardkim.github.io/rhwp/';
    if (hwpConvertingNote) hwpConvertingNote.style.display = 'inline';

    return file.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        var iframe = document.createElement('iframe');
        iframe.src = RHWP_URL;
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1280px;height:900px;border:none;';
        document.body.appendChild(iframe);

        var reqId = 0;
        var pending = new Map();

        function sendRequest(method, params) {
          return new Promise(function (res, rej) {
            var id = ++reqId;
            pending.set(id, { resolve: res, reject: rej });
            iframe.contentWindow.postMessage({ type: 'rhwp-request', id: id, method: method, params: params || {} }, '*');
            setTimeout(function () {
              if (pending.has(id)) { pending.delete(id); rej(new Error('rhwp 응답 타임아웃: ' + method)); }
            }, 30000);
          });
        }

        function onMessage(e) {
          if (e.data && e.data.type === 'rhwp-response' && e.data.id != null) {
            var r = pending.get(e.data.id);
            if (r) {
              pending.delete(e.data.id);
              if (e.data.error) r.reject(new Error(e.data.error));
              else r.resolve(e.data.result);
            }
          }
        }
        window.addEventListener('message', onMessage);

        function cleanup() {
          window.removeEventListener('message', onMessage);
          document.body.removeChild(iframe);
          if (hwpConvertingNote) hwpConvertingNote.style.display = 'none';
        }

        iframe.addEventListener('load', function () {
          sendRequest('ready')
            .then(function () { return sendRequest('loadFile', { data: new Uint8Array(buf), fileName: file.name }); })
            .then(function () { return sendRequest('exportHwpx'); })
            .then(function (result) {
              cleanup();
              var hwpxBytes = result instanceof Uint8Array ? result : new Uint8Array(result);
              var hwpxFile = new File(
                [new Blob([hwpxBytes], { type: 'application/vnd.hancom.hwpx' })],
                file.name.replace(/\.hwp$/i, '.hwpx'),
                { type: 'application/vnd.hancom.hwpx' }
              );
              var customName = getFileNameInputValue();
              return window.HwpxConvert.convertFile(hwpxFile, null, customName ? { outputName: customName } : undefined);
            })
            .then(resolve)
            .catch(function (err) { cleanup(); reject(err); });
        });
      });
    });
  }

  // ── Markdown → HWPX 변환 ─────────────────────────────────────────────────
  var mdFontSelect = document.getElementById('mdFontSelect');
  var mdFontSizeInput = document.getElementById('mdFontSize');
  var mdLoadLocalFontsBtn = document.getElementById('mdLoadLocalFontsBtn');
  var mdPreviewWrap = document.getElementById('mdPreview');
  var mdPageInfo = document.getElementById('mdPageInfo');
  var mdTokenCount = document.getElementById('mdTokenCount');
  var mdDownloadBtn = document.getElementById('mdDownloadBtn');
  var mdDownloadHint = document.getElementById('mdDownloadHint');
  var mdDocOptionsPanel = document.getElementById('mdDocOptions');
  var mdPreviewPanel = document.getElementById('mdPreviewPanel');
  var mdDownloadPanel = document.getElementById('mdDownloadPanel');

  var MD_DEFAULT_FONTS = [
    '함초롬바탕', '함초롬돋움', '맑은 고딕', '바탕', '바탕체', '굴림', '굴림체',
    '돋움', '돋움체', '궁서', '궁서체', 'HY견고딕', 'HY견명조',
    'Noto Sans KR', 'Noto Serif KR', 'Nanum Gothic', 'Nanum Myeongjo',
    'Pretendard', 'Apple SD Gothic Neo', 'AppleMyungjo'
  ];

  var mdSavedFont = '';
  var mdSavedSize = 10;
  try {
    mdSavedFont = localStorage.getItem('mh.font') || '';
    var _s = parseFloat(localStorage.getItem('mh.size'));
    if (!isNaN(_s) && _s > 0) mdSavedSize = _s;
  } catch (e) {}

  function populateMdFontSelect(localFonts) {
    if (!mdFontSelect) return;
    var prev = mdFontSelect.value;
    mdFontSelect.innerHTML = '';
    function addGroup(label, list) {
      var g = document.createElement('optgroup');
      g.label = label;
      list.forEach(function (f) {
        var o = document.createElement('option');
        o.value = f; o.textContent = f;
        o.style.fontFamily = '"' + f.replace(/"/g, '') + '"';
        g.appendChild(o);
      });
      mdFontSelect.appendChild(g);
    }
    addGroup('한글 기본 글꼴', MD_DEFAULT_FONTS);
    if (localFonts && localFonts.length) {
      var seen = {};
      MD_DEFAULT_FONTS.forEach(function (f) { seen[f] = true; });
      var extras = [];
      localFonts.forEach(function (f) {
        if (!seen[f]) { seen[f] = true; extras.push(f); }
      });
      extras.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
      addGroup('내 PC 글꼴 (' + extras.length + ')', extras);
    }
    var toSelect = prev || mdSavedFont || '함초롬바탕';
    var found = Array.from(mdFontSelect.options).some(function (o) {
      if (o.value === toSelect) { o.selected = true; return true; }
      return false;
    });
    if (!found && mdFontSelect.options.length) mdFontSelect.value = '함초롬바탕';
  }
  populateMdFontSelect();
  if (mdFontSizeInput) mdFontSizeInput.value = String(mdSavedSize);

  function mdCurrentFont() { return (mdFontSelect && mdFontSelect.value) || '함초롬바탕'; }
  function mdCurrentSize() {
    var v = parseFloat(mdFontSizeInput && mdFontSizeInput.value);
    if (isNaN(v) || v < 6) v = 10;
    if (v > 48) v = 48;
    return v;
  }

  function applyMdDocStyle() {
    if (!mdPreviewWrap) return;
    var f = mdCurrentFont();
    var sz = mdCurrentSize();
    mdPreviewWrap.style.setProperty('--doc-font', '"' + f.replace(/"/g, '') + '", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
    mdPreviewWrap.style.setProperty('--doc-pt', String(sz));
    try {
      localStorage.setItem('mh.font', f);
      localStorage.setItem('mh.size', String(sz));
    } catch (e) {}
  }

  if (mdFontSelect) mdFontSelect.addEventListener('change', function () { applyMdDocStyle(); renderMdPreview(); });
  if (mdFontSizeInput) mdFontSizeInput.addEventListener('input', function () { applyMdDocStyle(); renderMdPreview(); });

  if (mdLoadLocalFontsBtn) {
    if (!('queryLocalFonts' in window)) {
      mdLoadLocalFontsBtn.disabled = true;
      mdLoadLocalFontsBtn.title = '이 브라우저는 Local Font Access API를 지원하지 않습니다';
    }
    mdLoadLocalFontsBtn.addEventListener('click', function () {
      if (!('queryLocalFonts' in window)) {
        alert('이 브라우저에서는 PC 설치 글꼴을 직접 불러올 수 없습니다. Chrome/Edge에서 HTTPS로 접속한 뒤 다시 시도해 주세요.');
        return;
      }
      var prev = mdLoadLocalFontsBtn.textContent;
      mdLoadLocalFontsBtn.disabled = true;
      mdLoadLocalFontsBtn.textContent = '불러오는 중…';
      window.queryLocalFonts().then(function (fonts) {
        var familySet = {};
        fonts.forEach(function (f) { if (f.family) familySet[f.family] = true; });
        populateMdFontSelect(Object.keys(familySet));
        applyMdDocStyle();
        renderMdPreview();
      }).catch(function (e) {
        alert('글꼴을 불러오지 못했습니다: ' + e.message);
      }).then(function () {
        mdLoadLocalFontsBtn.disabled = false;
        mdLoadLocalFontsBtn.textContent = prev;
      });
    });
  }

  var currentMdText = null;
  var currentMdFileName = null;

  // 미리보기용 수식 보호 (marked가 $...$를 깨지 않도록)
  function mdProtectMath(md) {
    var phs = [];
    function add(latex, block) {
      var i = phs.length;
      phs.push({ latex: latex, block: block });
      return 'MDPREVMATHX' + i + 'XEND';
    }
    var fences = [];
    var masked = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, function (m) {
      var i = fences.length;
      fences.push(m);
      return 'MDPREVFENCEX' + i + 'XEND';
    });
    masked = masked.replace(/\$\$((?:(?!\n[ \t]*\n)[\s\S])+?)\$\$/g, function (_m, body) { return add(body, true); });
    masked = masked.replace(/\\\[([\s\S]+?)\\\]/g, function (_m, body) { return add(body, true); });
    masked = masked.replace(/\\\(([\s\S]+?)\\\)/g, function (_m, body) { return add(body, false); });
    masked = masked.replace(/(^|[^\\$])\$([^\$\n]+?)\$(?!\d)/g, function (m, pre, body) {
      return pre + add(body, false);
    });
    masked = masked.replace(/MDPREVFENCEX(\d+)XEND/g, function (_m, i) { return fences[+i]; });
    return { md: masked, phs: phs };
  }

  function mdRestoreMath(html, phs) {
    return html.replace(/MDPREVMATHX(\d+)XEND/g, function (_m, i) {
      var ph = phs[+i];
      if (!ph) return _m;
      return ph.block ? ('$$' + ph.latex + '$$') : ('$' + ph.latex + '$');
    });
  }

  // \multicolumn 표식(MDHWPMCOL<n>END) → colspan, 병합으로 넘친 뒤쪽 빈 셀 제거, 열 많은 표는 글자 축소
  function mdApplyTableSpans(stage) {
    if (!stage || !window.MarkdownToHwpx || !window.MarkdownToHwpx.MCOL_SOURCE) return;
    var re = new RegExp(window.MarkdownToHwpx.MCOL_SOURCE);
    stage.querySelectorAll('table').forEach(function (tbl) {
      var rows = Array.from(tbl.querySelectorAll('tr'));
      if (!rows.length) return;
      var headCols = rows[0].children.length;
      if (headCols >= 8) tbl.classList.add('wide');
      rows.forEach(function (tr) {
        Array.from(tr.children).forEach(function (cell) {
          var m = re.exec(cell.innerHTML);
          if (!m) return;
          cell.innerHTML = cell.innerHTML.replace(re, '');
          cell.colSpan = Math.max(1, parseInt(m[1], 10));
          cell.style.textAlign = 'center';
        });
        function width() {
          return Array.from(tr.children).reduce(function (a, c) { return a + (c.colSpan || 1); }, 0);
        }
        while (width() > headCols && tr.children.length > 1 &&
               !tr.lastElementChild.textContent.trim()) {
          tr.removeChild(tr.lastElementChild);
        }
      });
    });
  }

  function renderMdPreview() {
    if (!mdPreviewWrap || !window.marked) return;
    var text = currentMdText;
    if (!text || !text.trim()) {
      mdPreviewWrap.classList.add('empty');
      mdPreviewWrap.innerHTML = '<span class="placeholder">마크다운 파일을 올리면 미리보기가 나타납니다.</span>';
      if (mdTokenCount) mdTokenCount.textContent = '';
      if (mdPageInfo) mdPageInfo.textContent = '';
      return;
    }
    try {
      var protectedRes = mdProtectMath(text);
      // 변환 엔진(md-to-hwpx.js)과 같은 전처리 — `~` 단일 취소선 금지, 한글 조사 앞 `**`, \multicolumn
      var mdb = protectedRes.md;
      var parseOpts = { gfm: true, breaks: false };
      var MH = window.MarkdownToHwpx;
      if (MH && MH.lexOptions) {
        mdb = MH.fixCjkEmphasisHtml(MH.maskMulticolumn(mdb));
        parseOpts = MH.lexOptions(window.marked);
      }
      parseOpts.headerIds = false;
      var html = window.marked.parse(mdb, parseOpts);
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      html = mdRestoreMath(html, protectedRes.phs);
      html = html.replace(/&#36;/g, '$');

      mdPreviewWrap.classList.remove('empty');
      mdPreviewWrap.innerHTML = '<div class="doc-page" id="mdDocContent">' + html + '</div>';

      var stage = document.getElementById('mdDocContent');
      mdApplyTableSpans(stage);
      if (window.renderMathInElement && stage) {
        try {
          window.renderMathInElement(stage, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false,
            errorColor: '#c0392b',
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
          });
        } catch (e) {}
      }

      var tokens = window.marked.lexer(text, { gfm: true, breaks: false });
      if (mdTokenCount) mdTokenCount.textContent = tokens.length + '개 블록';

      requestAnimationFrame(function () { mdPaginate(stage); });
    } catch (e) {
      mdPreviewWrap.classList.remove('empty');
      mdPreviewWrap.innerHTML = '<div class="doc-page" style="color:#c0392b">미리보기 오류: ' + escHtml(e.message) + '</div>';
    }
  }

  function mdPaginate(firstPage) {
    if (!firstPage) return;
    var wrap = firstPage.parentNode;
    if (!wrap) return;

    function lockPageSize(p) {
      var w = p.clientWidth;
      if (!w) return;
      var targetH = Math.round(w * 297 / 210);
      p.style.height = targetH + 'px';
      p.style.minHeight = targetH + 'px';
      p.style.maxHeight = targetH + 'px';
    }
    lockPageSize(firstPage);

    var nodes = Array.from(firstPage.childNodes);
    firstPage.innerHTML = '';
    var currentPage = firstPage;

    function exceeds(p) { return p.scrollHeight > p.clientHeight; }
    function newPage() {
      var np = document.createElement('div');
      np.className = 'doc-page';
      wrap.appendChild(np);
      lockPageSize(np);
      return np;
    }

    var SAFETY_CAP = 500;
    var pageCount = 1;
    for (var i = 0; i < nodes.length && pageCount < SAFETY_CAP; i++) {
      var node = nodes[i];
      currentPage.appendChild(node);
      if (exceeds(currentPage)) {
        currentPage.removeChild(node);
        if (!currentPage.childNodes.length) {
          currentPage.appendChild(node);
          currentPage = newPage();
          pageCount++;
        } else {
          // 쪽 끝에 제목만 남지 않도록 직전 제목들은 다음 쪽으로 같이 넘긴다
          var carry = [];
          while (currentPage.children.length > 1 && /^H[1-6]$/.test(currentPage.lastElementChild.nodeName)) {
            carry.unshift(currentPage.removeChild(currentPage.lastElementChild));
          }
          currentPage = newPage();
          pageCount++;
          carry.forEach(function (h) { currentPage.appendChild(h); });
          currentPage.appendChild(node);
        }
      }
    }

    var pages = wrap.querySelectorAll('.doc-page');
    pages.forEach(function (p, i) {
      var el = document.createElement('div');
      el.className = 'page-num';
      el.textContent = '- ' + (i + 1) + ' -';
      p.appendChild(el);
    });
    if (mdPageInfo) mdPageInfo.textContent = pages.length + '쪽';
  }

  function showMdSections(visible) {
    // 미리보기·다운로드는 MD 전용
    [mdPreviewPanel, mdDownloadPanel].forEach(function (el) {
      if (!el) return;
      if (visible) el.classList.add('visible');
      else el.classList.remove('visible');
    });
    // 글꼴·크기도 MD 전용
    if (mdFontOptions) mdFontOptions.style.display = visible ? '' : 'none';
  }

  function showDocSettings(visible) {
    if (mdDocOptionsPanel) mdDocOptionsPanel.style.display = visible ? '' : 'none';
  }

  function runMarkdownConvert(file) {
    var reader = new FileReader();
    reader.onload = function () {
      currentMdText = String(reader.result || '');
      currentMdFileName = file.name;

      // 파일명 입력창이 비어있으면 마크다운 첫 # 제목으로 자동 채우기
      if (fileNameInput && !fileNameInput.value.trim()) {
        var mdTitle = extractMdTitle(currentMdText);
        if (mdTitle) fileNameInput.value = mdTitle;
      }

      showMdSections(true);
      applyMdDocStyle();
      renderMdPreview();

      if (mdDownloadBtn) {
        mdDownloadBtn.disabled = false;
        mdDownloadBtn.textContent = 'HWPX 내려받기';
      }

      clearFileResult();
      showFileCard(fileCardHtml('MD', file.name, '설정과 미리보기를 확인한 뒤 내려받으세요', ''), true);
    };
    reader.onerror = function () {
      clearFileResult();
      showFileError('파일을 읽지 못했습니다.');
    };
    reader.readAsText(file, 'utf-8');
  }

  function extractMdTitle(text) {
    if (!text) return '';
    var m = text.match(/^#\s+(.+)/m);
    return m ? m[1].replace(/[*_`]/g, '').trim() : '';
  }

  if (mdDownloadBtn) {
    mdDownloadBtn.addEventListener('click', function () {
      if (!currentMdText || !window.MarkdownToHwpx) return;
      var prevLabel = mdDownloadBtn.textContent;
      mdDownloadBtn.disabled = true;
      mdDownloadBtn.innerHTML = '<span class="conv-spinner"></span> 변환 중…';
      if (mdDownloadHint) mdDownloadHint.textContent = '';

      window.MarkdownToHwpx.convertMarkdown(currentMdText, {
        fontFamily: mdCurrentFont(),
        fontSizePt: mdCurrentSize()
      }, { templateUrl: 'templates/blank.hwpx' })
        .then(function (blob) {
          var customName = getFileNameInputValue();
          var stem = customName
            ? (window.HwpxConvert ? window.HwpxConvert.sanitizeFilename(customName) : customName.replace(/[\\/:*?"<>|]/g, '_').trim())
            : extractMdTitle(currentMdText)
              || (currentMdFileName ? currentMdFileName.replace(/\.(md|markdown)$/i, '') : '');
          var name = (stem || 'output') + '.hwpx';
          var file = (typeof File === 'function')
            ? new File([blob], name, { type: 'application/vnd.hancom.hwpx' })
            : blob;
          var url = URL.createObjectURL(file);
          var a = document.createElement('a');
          a.href = url; a.download = name; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          if (mdDownloadHint) mdDownloadHint.textContent = '다운로드 완료: ' + name;
        })
        .catch(function (err) {
          if (mdDownloadHint) { mdDownloadHint.textContent = '변환 실패: ' + err.message; mdDownloadHint.style.color = '#c0392b'; }
        })
        .then(function () {
          mdDownloadBtn.disabled = false;
          mdDownloadBtn.textContent = prevLabel;
        });
    });
  }

  function onFileSelected(file) {
    if (!file) return;
    var isMd = /\.(md|markdown)$/i.test(file.name);
    var isHwpx = /\.hwpx$/i.test(file.name);
    var isHwp = /\.hwp$/i.test(file.name) && !isHwpx;

    // 파일 선택 시 문서 설정 패널 표시 및 파일명 초기화
    showDocSettings(true);
    if (fileNameInput) fileNameInput.value = '';

    if (isMd) {
      showMdSections(true);
      currentMdText = null;
      runMarkdownConvert(file);
      return;
    }

    // HWP/HWPX: MD 섹션 숨기기
    showMdSections(false);
    currentMdText = null;
    currentMdFileName = null;

    if (!isHwp && !isHwpx) {
      clearFileResult();
      showFileError('HWP, HWPX, 마크다운(.md) 파일만 지원합니다.');
      return;
    }
    runFileConvert(file);
  }

  if (pickFileBtn) {
    pickFileBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (fileInputEl) fileInputEl.click();
    });
  }

  if (fileDrop) {
    fileDrop.addEventListener('click', function (e) {
      if (e.target === pickFileBtn) return;
      if (fileInputEl) fileInputEl.click();
    });
    fileDrop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (fileInputEl) fileInputEl.click(); }
    });
    fileDrop.addEventListener('dragover', function (e) { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', function () { fileDrop.classList.remove('dragover'); });
    fileDrop.addEventListener('drop', function (e) {
      e.preventDefault(); fileDrop.classList.remove('dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFileSelected(f);
    });
  }

  if (fileInputEl) {
    fileInputEl.addEventListener('change', function () {
      var f = fileInputEl.files && fileInputEl.files[0];
      if (f) onFileSelected(f);
      fileInputEl.value = '';
    });
  }
})();

