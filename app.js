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

  var DEFAULT_HINT = copyHint.textContent;
  var PLACEHOLDER = '<span class="placeholder">수식을 입력하면 여기에 렌더링됩니다.</span>';
  var autoCopyTimer = null;
  var hintTimer = null;

  function hideWarningModal() {
    modal.classList.remove('show');
  }

  function hideNoDelimiterModal() {
    noDelimModal.classList.remove('show');
  }

  function showNoDelimiterModal() {
    noDelimModal.classList.add('show');
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
    modal.classList.add('show');

    // 경고를 읽도록 '그냥 닫기'만 2초간 비활성화 (해결 방안 보기는 즉시 가능)
    var secondsLeft = 2;
    modalDismissBtn.disabled = true;
    var base = '그냥 닫기';
    modalDismissBtn.textContent = base + ' (' + secondsLeft + ')';
    clearInterval(modalDismissTimer);
    modalDismissTimer = setInterval(function () {
      secondsLeft--;
      if (secondsLeft > 0) {
        modalDismissBtn.textContent = base + ' (' + secondsLeft + ')';
      } else {
        clearInterval(modalDismissTimer);
        modalDismissBtn.disabled = false;
        modalDismissBtn.textContent = base;
      }
    }, 1000);
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
      copyText(NO_DELIM_PROMPT, function () {
        var original = noDelimPromptCopyBtn.textContent;
        noDelimPromptCopyBtn.textContent = '복사됨!';
        setTimeout(function () { noDelimPromptCopyBtn.textContent = original; }, 1200);
      });
    });
  }

  for (var ti = 0; ti < solutionTabs.length; ti++) {
    (function (tab) {
      tab.addEventListener('click', function () { selectSolution(tab.getAttribute('data-sol')); });
    })(solutionTabs[ti]);
  }

  // 방안 2: 이미지 OCR 영역으로 이동 (모달 닫고 드롭존을 잠깐 강조)
  if (gotoOcrBtn) {
    gotoOcrBtn.addEventListener('click', function () {
      hideWarningModal();
      var dz = document.getElementById('dropzone');
      if (dz) {
        dz.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dz.classList.add('dragover');
        setTimeout(function () { dz.classList.remove('dragover'); }, 1200);
      }
    });
  }

  if (promptCopyBtn) {
    promptCopyBtn.addEventListener('click', function () {
      copyText("답변에서 수식은 렌더링 하지 말고 순수 LaTeX 코드로 작성해 줘.\n복사 가능하도록 latex 코드 블록을 사용해 줘.", function () {
        var original = promptCopyBtn.textContent;
        promptCopyBtn.textContent = '복사됨!';
        setTimeout(function () { promptCopyBtn.textContent = original; }, 1200);
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

  function renderPreview(latex) {
    if (!latex) { preview.innerHTML = PLACEHOLDER; return; }
    
    // Apply AI-friendly preprocessing for preview
    var body = latex.trim();
    
    // Handle typos like \fras
    body = body.replace(/\\fras(?=[^a-zA-Z]|$)/g, '\\frac');
    
    // Handle specific mapping: \overset{!}{=} -> \neq (consistent with HWP output)
    body = body.replace(/\\overset\s*{\s*!\s*}\s*{\s*`?=`?\s*}/g, '\\neq');
    
    // Strip delimiters for KaTeX
    body = stripDelimiters(body);
    
    if (!body) { preview.innerHTML = PLACEHOLDER; return; }
    if (typeof katex === 'undefined') {
      preview.innerHTML = '<span class="placeholder">렌더러 로딩 중…</span>';
      return;
    }
    try {
      katex.render(body, preview, { displayMode: true, throwOnError: false });
    } catch (e) {
      preview.innerHTML = '<span class="render-error">렌더 오류: ' + (e.message || e) + '</span>';
    }
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
      output.classList.add('fallback-mode');
      output.style.color = "#d35400"; // Orange color to indicate warning/fallback
      renderPreview(val);
      clearTimeout(autoCopyTimer);
    } else {
      output.style.color = "";
      output.removeAttribute('data-warning');
      output.classList.remove('fallback-mode');
      var result = window.LatexToHwp.convert(val);
      output.textContent = result;
      renderPreview(val);

      if (isUndelimited && isPasting) {
        showNoDelimiterModal();
      }

      // 변환되면 자동으로 클립보드에 복사 (입력이 멈춘 뒤)
      clearTimeout(autoCopyTimer);
      if (result) {
        autoCopyTimer = setTimeout(function () {
          copyText(result, function () { flashHint('자동 복사됨 ✓'); });
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
  });

  copyBtn.addEventListener('click', function () {
    copyText(output.textContent, function () {
      var original = copyBtn.textContent;
      copyBtn.textContent = '복사됨!';
      setTimeout(function () { copyBtn.textContent = original; }, 1200);
    });
  });

  // ── 이미지 OCR (브라우저 로컬 · FormulaNet via transformers.js) ───────
  // 이미지 → (전처리) → 워커에서 모델 추론 → LaTeX → 기존 입력창에 넣어
  // 기존 클라이언트 변환 흐름(render)을 그대로 태운다. 서버는 쓰지 않는다.

  var dropzone = document.getElementById('dropzone');
  var imageInput = document.getElementById('imageInput');
  var pickImageBtn = document.getElementById('pickImageBtn');
  var ocrStatus = document.getElementById('ocrStatus');
  var ocrPreviewImg = document.getElementById('ocrPreviewImg');

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

    if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
    lastPreviewUrl = URL.createObjectURL(blob);
    ocrPreviewImg.src = lastPreviewUrl;
    ocrPreviewImg.hidden = false;

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
    pickImageBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      imageInput.click();
    });
  }

  if (dropzone) {
    dropzone.addEventListener('click', function (e) {
      if (e.target === pickImageBtn) return;
      imageInput.click();
    });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imageInput.click(); }
    });
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) runOcr(f);
      else setOcrStatus('이미지 파일을 끌어다 놓아 주세요.', 'error');
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
  }

  if (tabTextBtn) tabTextBtn.addEventListener('click', function () { activateTab('text'); });
  if (tabFileBtn) tabFileBtn.addEventListener('click', function () { activateTab('file'); });

  // ── 파일 변환 (HWP / HWPX → 수식 개체 삽입) ──────────────────────────────
  var fileDrop = document.getElementById('fileDrop');
  var fileInputEl = document.getElementById('fileInput');
  var pickFileBtn = document.getElementById('pickFileBtn');
  var fileResultEl = document.getElementById('fileResult');
  var hwpConvertingNote = document.getElementById('hwpConvertingNote');

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

  function showFileError(msg) {
    fileResultEl.style.display = 'block';
    fileResultEl.innerHTML =
      '<div class="conv-summary err"><span class="conv-check">⚠</span><span class="conv-fname">' + escHtml(msg) + '</span></div>';
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
      var summaryClass = (forcedEq > 0 && normalEq === 0) ? 'no-eq' : '';
      var checkIcon = (forcedEq > 0 && normalEq === 0) ? '⚠' : '✓';
      html += '<div class="conv-summary ' + summaryClass + '">' +
        '<span class="conv-check">' + checkIcon + '</span>' +
        '<span class="conv-fname">' + escHtml(filename) + '</span>' +
        '<span class="conv-meta">' + metaParts.join(' · ') + '</span>' +
        '</div>';
      html += '<a class="dl-btn" href="' + fileResultUrl + '" download="' + escHtml(filename) + '">변환된 파일 다운로드</a>';

      if (forcedEq > 0) {
        html += '<div class="hwp-notice" style="margin-top:12px;">' +
          '<b>⚠ 강제 변환 경고</b><br>' +
          '문서에서 <b>$$</b> 없이 작성된 LaTeX ' + forcedEq + '개를 강제로 변환했습니다. ' +
          '정확도가 떨어질 수 있으니 아래 프롬프트로 AI에게 다시 요청하세요.<br>' +
          '<div class="prompt-box" style="margin-top:10px;">' +
          '<strong class="prompt-text">' + escHtml(NO_DELIM_PROMPT) + '</strong>' +
          '<button class="btn prompt-copy-btn" id="fileNoDelimCopyBtn" type="button">복사</button>' +
          '</div></div>';
      }
    } else {
      html += '<div class="conv-summary no-eq">' +
        '<span class="conv-check">⚠</span>' +
        '<span class="conv-fname">' + escHtml(filename) + '</span>' +
        '<span class="conv-meta">변환할 LaTeX 수식 없음</span>' +
        '</div>';
    }

    fileResultEl.innerHTML = html;
    fileResultEl.style.display = 'block';

    var fileNoDelimCopyBtn = document.getElementById('fileNoDelimCopyBtn');
    if (fileNoDelimCopyBtn) {
      fileNoDelimCopyBtn.addEventListener('click', function () {
        copyText(NO_DELIM_PROMPT, function () {
          fileNoDelimCopyBtn.textContent = '복사됨!';
          setTimeout(function () { fileNoDelimCopyBtn.textContent = '복사'; }, 1200);
        });
      });
    }
  }

  function runFileConvert(file) {
    if (!file) return;
    clearFileResult();

    var isHwpx = /\.hwpx$/i.test(file.name);
    var isHwp = /\.hwp$/i.test(file.name) && !isHwpx;

    fileResultEl.style.display = 'block';
    fileResultEl.innerHTML = '<div class="result-badge ok"><span class="conv-spinner"></span> 변환 중…</div>';

    var convertPromise = isHwp
      ? convertHwpViaRhwp(file)
      : convertHwpx(file);

    convertPromise
      .then(function (out) { showFileResult(out.blob, out.stats, out.filename); })
      .catch(function (err) { showFileError((err && err.message) ? err.message : String(err)); });
  }

  // HWPX 직접 변환 (hwpx-convert.js 사용)
  function convertHwpx(file) {
    return window.HwpxConvert.convertFile(file);
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
              return window.HwpxConvert.convertFile(hwpxFile);
            })
            .then(resolve)
            .catch(function (err) { cleanup(); reject(err); });
        });
      });
    });
  }

  function onFileSelected(file) {
    if (!file) return;
    var isHwpx = /\.hwpx$/i.test(file.name);
    var isHwp = /\.hwp$/i.test(file.name) && !isHwpx;
    if (!isHwp && !isHwpx) {
      clearFileResult();
      fileResultEl.style.display = 'block';
      fileResultEl.innerHTML = '<div class="result-badge err">⚠ HWP(.hwp) 또는 HWPX(.hwpx) 파일만 지원합니다.</div>';
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

