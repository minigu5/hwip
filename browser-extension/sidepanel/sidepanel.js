'use strict';

var i18n = window.hwpT;

(function () {
  var status = document.getElementById('status');
  var downloadBtn = document.getElementById('downloadBtn');
  var fontFamilySel = document.getElementById('fontFamily');
  var fontSizeSel = document.getElementById('fontSize');
  var loadLocalFontsBtn = document.getElementById('loadLocalFontsBtn');
  var fileNameInput = document.getElementById('fileNameInput');
  var previewContent = document.getElementById('previewContent');

  var md = '';
  var savedFont = '';

  var DEFAULT_FONTS = [
    '함초롬바탕', '함초롬돋움', '맑은 고딕', '바탕', '바탕체',
    '굴림', '굴림체', '돋움', '돋움체', '궁서', '궁서체',
    'HY헤드라인M', 'HY견고딕', 'HY견명조',
    'Noto Sans KR', 'Noto Serif KR', 'Nanum Gothic', 'Nanum Myeongjo',
    'Times New Roman', 'Arial'
  ];

  function setStatus(msg, cls) {
    status.textContent = msg;
    status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function populateFontSelect(localFonts) {
    var prev = fontFamilySel.value;
    fontFamilySel.innerHTML = '';

    var defOpt = document.createElement('option');
    defOpt.value = ''; defOpt.textContent = i18n('fontDefault');
    fontFamilySel.appendChild(defOpt);

    function addGroup(label, list) {
      var g = document.createElement('optgroup');
      g.label = label;
      list.forEach(function (f) {
        var o = document.createElement('option');
        o.value = f; o.textContent = f;
        g.appendChild(o);
      });
      fontFamilySel.appendChild(g);
    }

    addGroup(i18n('fontGroupDefault'), DEFAULT_FONTS);

    if (localFonts && localFonts.length) {
      var seen = {};
      DEFAULT_FONTS.forEach(function (f) { seen[f] = true; });
      var extras = [];
      localFonts.forEach(function (f) {
        if (!seen[f]) { seen[f] = true; extras.push(f); }
      });
      extras.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
      if (extras.length) {
        addGroup(i18n('fontGroupLocal') + ' (' + extras.length + ')', extras);
      }
    }

    var toSelect = prev || savedFont || '함초롬바탕';
    var found = Array.from(fontFamilySel.options).some(function (o) {
      if (o.value === toSelect) { o.selected = true; return true; }
      return false;
    });
    if (!found) fontFamilySel.value = '';
  }

  function tryAutoLoad() {
    if (!('queryLocalFonts' in window)) {
      loadLocalFontsBtn.disabled = true;
      loadLocalFontsBtn.title = i18n('fontLocalUnsupported');
      return;
    }
    window.queryLocalFonts().then(function (fonts) {
      var familySet = {};
      fonts.forEach(function (f) { if (f.family) familySet[f.family] = true; });
      populateFontSelect(Object.keys(familySet));
      loadLocalFontsBtn.textContent = i18n('fontLocalRefresh');
    }).catch(function () {});
  }

  if (loadLocalFontsBtn) {
    loadLocalFontsBtn.addEventListener('click', function () {
      if (!('queryLocalFonts' in window)) return;
      loadLocalFontsBtn.disabled = true;
      var origText = loadLocalFontsBtn.textContent;
      loadLocalFontsBtn.textContent = i18n('fontLocalLoading');
      window.queryLocalFonts().then(function (fonts) {
        var familySet = {};
        fonts.forEach(function (f) { if (f.family) familySet[f.family] = true; });
        populateFontSelect(Object.keys(familySet));
        loadLocalFontsBtn.textContent = i18n('fontLocalRefresh');
        loadLocalFontsBtn.disabled = false;
      }).catch(function () {
        loadLocalFontsBtn.textContent = origText;
        loadLocalFontsBtn.disabled = false;
      });
    });
  }

  function applyPreviewFont() {
    var family = fontFamilySel.value || '함초롬바탕';
    previewContent.style.fontFamily = '"' + family + '", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  }

  fontFamilySel.addEventListener('change', function () {
    chrome.storage.local.set({ 'mh.ext.font': fontFamilySel.value });
    applyPreviewFont();
  });

  function extractMdTitle(text) {
    if (!text) return '';
    // H1 ~ H6 헤딩 우선
    var m = text.match(/^#{1,6}\s+(.+)/m);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
    // 헤딩 없으면 첫 번째 비어있지 않은 줄
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
        .replace(/^[>\-*+\d.]+\s*/, '')   // 인용·리스트 기호 제거
        .replace(/[*_`~]/g, '')            // 강조 기호 제거
        .replace(/\$\$?[\s\S]*?\$\$?/g, '') // 수식 제거
        .trim();
      if (line) return line.slice(0, 60);
    }
    return 'output';
  }

  function sanitizeFilename(name) {
    return (name || '').replace(/[\\/:*?"<>|\t\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'output';
  }

  // **bold**한글처럼 닫는 ** 바로 뒤에 CJK 문자가 붙으면 CommonMark가 닫힘 마커로
  // 인정하지 않아 marked가 bold를 무시함. 닫는 ** 뒤에 공백을 삽입해 보정.
  var CJK_CLASS = '[\\uAC00-\\uD7AF\\u3130-\\u318F\\u4E00-\\u9FFF\\u3040-\\u309F\\u30A0-\\u30FF]';
  function fixCjkEmphasis(text) {
    text = text.replace(
      new RegExp('\\*\\*([^*\\n]+?)\\*\\*(?=' + CJK_CLASS + ')', 'g'),
      function (_, body) { return '**' + body + '** '; }
    );
    text = text.replace(
      new RegExp('(^|[^*\\\\])\\*([^*\\n\\s](?:[^*\\n]*[^*\\n\\s])?)\\*(?=' + CJK_CLASS + ')', 'g'),
      function (_, pre, body) { return pre + '*' + body + '* '; }
    );
    return text;
  }

  // 수식 sentinel 보호 — marked가 $...$·\[...\] 내 _·*·\ 를 마크다운으로 깨지 않도록
  function mdProtectMath(text) {
    var phs = [];
    function add(latex, block) {
      var i = phs.length;
      phs.push({ latex: latex, block: block });
      return 'MDPREVMATHX' + i + 'XEND';
    }
    var fences = [];
    var masked = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, function (m) {
      var i = fences.length; fences.push(m); return 'MDPREVFENCEX' + i + 'XEND';
    });
    masked = masked.replace(/\$\$([\s\S]+?)\$\$/g, function (_m, b) { return add(b, true); });
    masked = masked.replace(/\\\[([\s\S]+?)\\\]/g, function (_m, b) { return add(b, true); });
    masked = masked.replace(/\\\(([\s\S]+?)\\\)/g, function (_m, b) { return add(b, false); });
    masked = masked.replace(/(^|[^\\$])\$([^\$\n]+?)\$(?!\d)/g, function (m, pre, b) { return pre + add(b, false); });
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

  // 마크다운 → A4 미리보기
  function renderPreview(mdText) {
    if (!mdText || !window.marked) {
      previewContent.innerHTML = '<div class="preview-placeholder">' + i18n('previewUnavailable') + '</div>';
      return;
    }
    try {
      var protectedRes = mdProtectMath(fixCjkEmphasis(mdText));
      var html = window.marked.parse(protectedRes.md, { gfm: true, breaks: false });
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      html = mdRestoreMath(html, protectedRes.phs);
      html = html.replace(/&#36;/g, '$');
      previewContent.innerHTML = html;
      applyPreviewFont();
      if (window.renderMathInElement) {
        try {
          renderMathInElement(previewContent, {
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
        } catch (e) { /* KaTeX 오프라인 시 조용히 실패 */ }
      }
    } catch (e) {
      previewContent.innerHTML = '<div class="preview-placeholder">' + i18n('previewRenderFailed') + '</div>';
    }
  }

  function doConvert() {
    if (!md) { setStatus(i18n('noMarkdown'), 'error'); return; }

    downloadBtn.disabled = true;
    downloadBtn.textContent = i18n('converting');
    setStatus(i18n('convertingLong'), '');

    var fontFamily = fontFamilySel.value;
    var fontSizePt = parseInt(fontSizeSel.value, 10) || 10;
    var templateUrl = chrome.runtime.getURL('templates/blank.hwpx');

    var deps = {
      JSZip: window.JSZip,
      marked: window.marked,
      LatexToHwp: window.LatexToHwp,
      DOMParser: window.DOMParser,
      XMLSerializer: window.XMLSerializer,
      templateUrl: templateUrl
    };

    var options = {};
    if (fontFamily) options.fontFamily = fontFamily;
    options.fontSizePt = fontSizePt;

    window.MarkdownToHwpx.convertMarkdown(md, options, deps)
      .then(function (blob) {
        var customName = fileNameInput ? fileNameInput.value.trim() : '';
        var stem = customName
          ? sanitizeFilename(customName)
          : sanitizeFilename(extractMdTitle(md));
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = stem + '.hwpx';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 500);

        setStatus(i18n('convertDone'), 'success');
        // 다운로드 후 사이드패널 닫기
        setTimeout(function () {
          chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tabId = tabs && tabs[0] && tabs[0].id;
            if (tabId && chrome.sidePanel) {
              chrome.sidePanel.setOptions({ tabId: tabId, enabled: false }, function () {
                void chrome.runtime.lastError;
              });
            }
          });
        }, 800);
      })
      .catch(function (err) {
        setStatus(i18n('convertFailedPrefix') + (err && err.message || String(err)), 'error');
        downloadBtn.textContent = i18n('retry');
        downloadBtn.disabled = false;
      });
  }

  downloadBtn.addEventListener('click', doConvert);

  function applyMd(newMd) {
    md = newMd;
    setStatus('', '');
    downloadBtn.disabled = false;
    if (fileNameInput && !fileNameInput.value.trim()) {
      fileNameInput.value = extractMdTitle(md);
    }
    renderPreview(md);
  }

  function loadMd() {
    chrome.storage.local.get('hwpxReportMd', function (data) {
      if (chrome.runtime.lastError) {
        setStatus(i18n('storageErrorPrefix') + chrome.runtime.lastError.message, 'error');
        downloadBtn.disabled = true;
        return;
      }
      var loaded = (data && data.hwpxReportMd) || '';
      if (!loaded) {
        if (!md) {
          setStatus(i18n('nothingToConvert'), 'error');
          downloadBtn.disabled = true;
          previewContent.innerHTML = '<div class="preview-placeholder">' + i18n('previewPlaceholderHtml') + '</div>';
        }
        return;
      }
      chrome.storage.local.remove('hwpxReportMd');
      applyMd(loaded);
    });
  }

  // 이미 열려있는 사이드패널에 새 마크다운이 들어올 때 자동 갱신
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.hwpxReportMd && changes.hwpxReportMd.newValue) {
      var newMd = changes.hwpxReportMd.newValue;
      chrome.storage.local.remove('hwpxReportMd');
      if (fileNameInput) fileNameInput.value = '';
      applyMd(newMd);
    }
  });

  function init() {
    chrome.storage.local.get('mh.ext.font', function (data) {
      savedFont = (data && data['mh.ext.font']) || '';
      populateFontSelect();
      tryAutoLoad();
      // background에 ready 신호 → 대기 중인 md가 있으면 response로 바로 받음
      chrome.runtime.sendMessage({ type: 'sidepanel-ready' }, function (response) {
        void chrome.runtime.lastError;
        if (response && response.md) {
          applyMd(response.md);
        } else {
          loadMd();
        }
      });
    });
  }

  window.addEventListener('pagehide', function () {
    chrome.storage.session.remove('panelTabId');
  });

  init();
})();
