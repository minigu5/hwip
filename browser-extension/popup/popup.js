'use strict';

var i18n = window.hwpT;

// 팝업이 열리는 순간 hwpxReportMd가 있으면 사이드패널로 자동 전환
if (chrome.sidePanel) {
  chrome.storage.local.get('hwpxReportMd', function (data) {
    if (!data || !data.hwpxReportMd) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tabId = tabs && tabs[0] && tabs[0].id;
      if (!tabId) return;
      chrome.sidePanel.setOptions(
        { tabId: tabId, path: 'sidepanel/sidepanel.html', enabled: true },
        function () {
          if (chrome.runtime.lastError) return;
          chrome.sidePanel.open({ tabId: tabId }, function () {
            void chrome.runtime.lastError;
            window.close();
          });
        }
      );
    });
  });
}

/* 팝업: 수동 LaTeX 입력 → hwip.dshs.dev API → 출력 → 복사. */
(function () {
  var input = document.getElementById('input');
  var output = document.getElementById('output');
  var copyBtn = document.getElementById('copyBtn');
  var hint = document.getElementById('hint');
  var siteLinkBtn = document.getElementById('siteLinkBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var backBtn = document.getElementById('backBtn');
  var mainView = document.getElementById('mainView');
  var settingsView = document.getElementById('settingsView');
  var toggleFormulaCopy = document.getElementById('toggleFormulaCopy');
  var toggleHwpxReport = document.getElementById('toggleHwpxReport');
  var langSelect = document.getElementById('langSelect');

  if (siteLinkBtn) {
    siteLinkBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = 'https://hwip.dshs.dev/';
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url: url });
      } else {
        window.open(url, '_blank');
      }
    });
  }

  var API_URL = 'https://hwip.dshs.dev/api/convert';
  var DEFAULT_HINT = hint.textContent;
  var hintTimer = null;
  var debounceTimer = null;

  function flashHint(msg) {
    clearTimeout(hintTimer);
    hint.textContent = msg;
    hint.classList.add('copied');
    hintTimer = setTimeout(function () {
      hint.textContent = DEFAULT_HINT;
      hint.classList.remove('copied');
    }, 1500);
  }

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
      } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  function render() {
    var latex = input.value.trim();
    if (!latex) { output.textContent = ''; return; }
    output.textContent = i18n('converting');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: latex })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) { output.textContent = data.result || ''; })
      .catch(function() { output.textContent = i18n('convertFailedNetwork'); });
    }, 300);
  }

  input.addEventListener('input', render);

  copyBtn.addEventListener('click', function () {
    copyText(output.textContent, function () {
      copyBtn.textContent = i18n('copied');
      copyBtn.classList.add('copied');
      flashHint(i18n('hintCopied'));
      setTimeout(function () {
        copyBtn.textContent = i18n('copy');
        copyBtn.classList.remove('copied');
      }, 1200);
    });
  });

  render();
  input.focus();

  // ── 설정 뷰 전환 ───────────────────────────────────────────────
  var STORAGE_DEFAULTS = { autoFormulaCopy: true, autoHwpxReport: true, uiLang: 'auto' };

  function showSettings() {
    mainView.hidden = true;
    settingsView.hidden = false;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(STORAGE_DEFAULTS, function (s) {
        toggleFormulaCopy.checked = !!s.autoFormulaCopy;
        toggleHwpxReport.checked = !!s.autoHwpxReport;
        langSelect.value = s.uiLang;
      });
    }
  }

  function showMain() {
    settingsView.hidden = true;
    mainView.hidden = false;
    input.focus();
  }

  if (settingsBtn) settingsBtn.addEventListener('click', showSettings);
  if (backBtn) backBtn.addEventListener('click', showMain);

  if (toggleFormulaCopy) {
    toggleFormulaCopy.addEventListener('change', function () {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({ autoFormulaCopy: toggleFormulaCopy.checked });
      }
    });
  }
  if (toggleHwpxReport) {
    toggleHwpxReport.addEventListener('change', function () {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({ autoHwpxReport: toggleHwpxReport.checked });
      }
    });
  }

  // 언어 변경: 저장 후 팝업을 다시 불러와 모든 문구(동적 상태 문구 포함)를 새 언어로 그린다.
  // 다시 열렸을 때 설정 화면에 머물도록 해시로 표시한다.
  if (langSelect) {
    langSelect.addEventListener('change', function () {
      chrome.storage.sync.set({ uiLang: langSelect.value }, function () {
        location.hash = 'settings';
        location.reload();
      });
    });
  }
  if (location.hash === '#settings') showSettings();

  // ── 현재 페이지 상태 + 활성화 흐름 ─────────────────────────────
  // 자동 지원 사이트(manifest content_scripts.matches): 그대로 동작.
  // 그 외 페이지는 차단 사유별로 분기 — HTTPS는 권한 요청, file://는 토글 안내,
  // chrome://·웹스토어 등은 우회 불가 안내. 버튼 한 번 누르면 동일한 UX로 진행.
  var pageStatus = document.getElementById('pageStatus');
  var pageStatusText = document.getElementById('pageStatusText');
  var forceOnBtn = document.getElementById('forceOnBtn');
  var guidePanel = document.getElementById('guidePanel');
  var guideTitle = document.getElementById('guideTitle');
  var guideSteps = document.getElementById('guideSteps');
  var guideNote = document.getElementById('guideNote');
  var guideCloseBtn = document.getElementById('guideCloseBtn');
  var guideOpenBtn = document.getElementById('guideOpenBtn');

  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
    if (pageStatus) pageStatus.hidden = true;
    return;
  }

  // ── 헬퍼 ────────────────────────────────────────────────────
  function matchToRegex(pattern) {
    if (pattern === '<all_urls>') return /^(https?|file):\/\//;
    var m = pattern.match(/^(\*|https?|file):\/\/([^\/]*)(\/.*)$/);
    if (!m) return null;
    var scheme = m[1] === '*' ? 'https?' : m[1];
    var host = m[2]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/^\*\\\./, '([^/]+\\.)?')
      .replace(/\*/g, '[^/]*');
    var path = m[3]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + scheme + '://' + host + path);
  }

  function setStatus(text, cls) {
    pageStatusText.textContent = text;
    pageStatus.className = 'page-status' + (cls ? ' ' + cls : '');
  }

  function hideGuide() { guidePanel.hidden = true; }

  function showGuide(opts) {
    guideTitle.textContent = opts.title || '';
    guideSteps.innerHTML = '';
    (opts.steps || []).forEach(function (step) {
      var li = document.createElement('li');
      // step에 <code> 태그가 포함될 수 있어 innerHTML 사용. 내용은 코드 안에서 통제.
      li.innerHTML = step;
      guideSteps.appendChild(li);
    });
    if (opts.note) { guideNote.textContent = opts.note; guideNote.hidden = false; }
    else { guideNote.hidden = true; }
    if (opts.openUrl) {
      guideOpenBtn.hidden = false;
      guideOpenBtn.textContent = opts.openLabel || i18n('openSettingsPage');
      guideOpenBtn.onclick = function () { chrome.tabs.create({ url: opts.openUrl }); };
    } else {
      guideOpenBtn.hidden = true;
      guideOpenBtn.onclick = null;
    }
    guidePanel.hidden = false;
  }

  guideCloseBtn.addEventListener('click', hideGuide);

  var manifest = chrome.runtime.getManifest();
  var matches = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].matches) || [];
  var INJECT_FILES = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].js) || ['content/content.js'];
  var INJECT_CSS = (manifest.content_scripts && manifest.content_scripts[0] &&
    manifest.content_scripts[0].css) || ['content/content.css'];

  function probeInjected(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () { return !!window.__hwpFormulaCopyInjected; }
    }).then(function (results) {
      return !!(results && results[0] && results[0].result);
    });
  }

  // 페이지 카테고리 분류
  // - auto: 정적 매칭 (자동 지원)
  // - https / http: 정상 권한 요청 흐름
  // - file: file URL 액세스 토글이 필요
  // - webstore: Chrome Web Store (정책 차단)
  // - internal: chrome://, chrome-extension://, edge://, view-source:, devtools:// 등 (정책 차단)
  // - unknown: 그 외 (about:blank 등)
  function classify(url) {
    if (!url) return 'unknown';
    if (/^https:\/\/chromewebstore\.google\.com/.test(url) ||
        /^https:\/\/chrome\.google\.com\/webstore/.test(url)) return 'webstore';
    if (/^https?:\/\//.test(url)) {
      if (matches.some(function (p) { var re = matchToRegex(p); return re && re.test(url); })) return 'auto';
      return 'web';
    }
    if (/^file:\/\//.test(url)) return 'file';
    if (/^(chrome|edge|brave|opera|vivaldi|chrome-extension|chrome-untrusted|view-source|devtools|about):/.test(url)) return 'internal';
    return 'unknown';
  }

  function isPdfUrl(url) {
    try {
      var u = new URL(url);
      return /\.pdf($|[?#])/i.test(u.pathname + u.search);
    } catch (e) { return false; }
  }

  // ── PDF 한계 경고 ───────────────────────────────────────────
  // Chrome 내장 PDF 뷰어는 chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/
  // iframe 안에서 동작 — 확장 스크립트가 그 iframe엔 닿지 않는다. 페이지 자체
  // 활성화는 가능하나 PDF 내부 수식 자동 감지는 안 됨을 안내.
  var PDF_NOTE = i18n('pdfNote');

  // ── 활성화 흐름들 ──────────────────────────────────────────
  function requestPermissionAndActivate(tab, originPattern) {
    forceOnBtn.disabled = true;
    forceOnBtn.textContent = i18n('permRequesting');
    chrome.permissions.request({ origins: [originPattern] }, function (granted) {
      if (chrome.runtime.lastError || !granted) {
        var reason = (chrome.runtime.lastError && chrome.runtime.lastError.message)
          || i18n('permDenied');
        setStatus(reason, 'disabled');
        forceOnBtn.disabled = false;
        forceOnBtn.textContent = i18n('retry');
        return;
      }
      setStatus(i18n('activating'), '');
      forceOnBtn.textContent = i18n('activating');
      var tries = 0;
      (function poll() {
        probeInjected(tab.id).then(function (ok) {
          if (ok) {
            setStatus(i18n('activatedPersist'), 'supported');
            forceOnBtn.hidden = true;
            return;
          }
          if (++tries < 8) { setTimeout(poll, 150); return; }
          setStatus(i18n('permGrantedReload'), 'supported');
          forceOnBtn.hidden = true;
        }, function () {
          setStatus(i18n('permGrantedReload'), 'supported');
          forceOnBtn.hidden = true;
        });
      })();
    });
  }

  function activateForFile(tab) {
    // 1) file URL 액세스 토글 확인 (chrome.extension은 popup에서 사용 가능)
    var allowed;
    try { allowed = chrome.extension.isAllowedFileSchemeAccess; } catch (e) { allowed = null; }
    if (!allowed) {
      // 구버전 호환 — 그냥 권한 요청 시도
      requestPermissionAndActivate(tab, 'file:///*');
      return;
    }
    chrome.extension.isAllowedFileSchemeAccess(function (ok) {
      if (!ok) {
        // 토글이 꺼져 있다 — 안내 + 설정 페이지 자동 오픈 + 권한도 같이 요청
        showFileAccessGuide();
        return;
      }
      // 토글이 켜져 있다 — 일반 권한 요청 흐름
      requestPermissionAndActivate(tab, 'file:///*');
    });
  }

  function showFileAccessGuide() {
    var extId = chrome.runtime.id;
    var settingsUrl = 'chrome://extensions/?id=' + extId;
    showGuide({
      title: i18n('fileGuideTitle'),
      steps: [
        i18n('fileGuideStep1'),
        i18n('fileGuideStep2'),
        i18n('fileGuideStep3')
      ],
      note: i18n('fileGuideNote'),
      openUrl: settingsUrl,
      openLabel: i18n('openSettingsPage')
    });
    setStatus(i18n('fileAccessNeeded'), 'disabled');
    forceOnBtn.disabled = false;
    forceOnBtn.textContent = i18n('retry');
  }

  function showInternalPageGuide(url) {
    var isPdfLike = /\.pdf/i.test(url || '');
    showGuide({
      title: i18n('internalGuideTitle'),
      steps: isPdfLike ? [
        i18n('internalPdfStep1'),
        i18n('internalPdfStep2'),
        i18n('internalPdfStep3')
      ] : [
        i18n('internalStep1'),
        i18n('internalStep2'),
        i18n('internalStep3')
      ],
      note: isPdfLike
        ? i18n('internalPdfNote')
        : null
    });
    setStatus(i18n('unavailableHere'), 'disabled');
    forceOnBtn.hidden = true;
  }

  // ── 진입점: 현재 탭 분류 후 분기 ───────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    var url = (tab && tab.url) || '';
    var kind = classify(url);

    if (kind === 'auto') {
      setStatus(i18n('autoSupported'), 'supported');
      forceOnBtn.hidden = true;
      return;
    }

    // web/file/internal/webstore/unknown — 일단 버튼은 항상 보여준다.
    if (kind === 'web') {
      setStatus(i18n('pageChecking'), '');
      forceOnBtn.hidden = true;
      probeInjected(tab.id).then(function (injected) {
        if (injected) {
          setStatus(i18n('activatedHover'), 'supported');
          forceOnBtn.hidden = true;
        } else {
          setStatus(isPdfUrl(url)
            ? i18n('pdfPageStatus')
            : i18n('notInAutoList'), '');
          forceOnBtn.hidden = false;
          forceOnBtn.textContent = i18n('enableOnPage');
          forceOnBtn.disabled = false;
        }
      }, function () {
        setStatus(i18n('notInAutoList'), '');
        forceOnBtn.hidden = false;
        forceOnBtn.textContent = i18n('enableOnPage');
      });

      forceOnBtn.onclick = function () {
        if (!tab || !tab.id) return;
        var u;
        try { u = new URL(url); } catch (e) {
          setStatus(i18n('activateFailedUrl'), 'disabled');
          return;
        }
        var originPattern = u.protocol + '//' + u.hostname + '/*';
        requestPermissionAndActivate(tab, originPattern);
        if (isPdfUrl(url)) {
          showGuide({
            title: i18n('pdfGuideTitle'),
            steps: [
              i18n('pdfGuideStep1'),
              i18n('pdfGuideStep2')
            ],
            note: PDF_NOTE
          });
        }
      };
      return;
    }

    if (kind === 'file') {
      setStatus(isPdfUrl(url)
        ? i18n('localPdfStatus')
        : i18n('localFileStatus'), '');
      forceOnBtn.hidden = false;
      forceOnBtn.textContent = i18n('enableOnPage');
      forceOnBtn.disabled = false;
      // 이미 주입돼 있는지 확인
      if (tab && tab.id) {
        probeInjected(tab.id).then(function (injected) {
          if (injected) {
            setStatus(i18n('activatedShort'), 'supported');
            forceOnBtn.hidden = true;
          }
        }, function () { /* 무시 */ });
      }
      forceOnBtn.onclick = function () {
        if (!tab || !tab.id) return;
        activateForFile(tab);
        if (isPdfUrl(url)) {
          // PDF는 항상 한계를 함께 안내
          setTimeout(function () {
            if (guidePanel.hidden) {
              showGuide({
                title: i18n('localPdfGuideTitle'),
                steps: [
                  i18n('pdfGuideStep1'),
                  i18n('pdfGuideStep2')
                ],
                note: PDF_NOTE
              });
            }
          }, 300);
        }
      };
      return;
    }

    if (kind === 'internal' || kind === 'webstore' || kind === 'unknown') {
      // 차단 페이지 — 버튼은 "활성화 방법 보기"로 바뀐다.
      setStatus(kind === 'webstore'
        ? i18n('webstoreBlocked')
        : i18n('unavailableHere'), 'disabled');
      forceOnBtn.hidden = false;
      forceOnBtn.disabled = false;
      forceOnBtn.textContent = i18n('howToActivate');
      forceOnBtn.onclick = function () { showInternalPageGuide(url); };
      return;
    }
  });
})();
