'use strict';
/*
 * content script 용 다국어 헬퍼 — content.js / report-extract.js 가 공유
 *
 * 설정(chrome.storage.sync 의 uiLang)이 'ko'/'en' 이면 background 에서 해당 언어
 * 메시지를 받아 쓰고, 'auto' 면 chrome.i18n(브라우저 언어)을 그대로 쓴다.
 * content script 는 확장 파일을 직접 fetch 할 수 없어 background 를 거친다.
 *
 * - window.__hwpMsgReady : 메시지 로드가 끝나면 resolve 되는 Promise (실패해도 resolve)
 * - window.__hwpMsg(key, fallback)
 */
(function () {
  if (window.__hwpMsgReady) return; // 중복 주입 방지

  var dict = null;

  window.__hwpMsgReady = new Promise(function (resolve) {
    try {
      chrome.storage.sync.get({ uiLang: 'auto' }, function (s) {
        var lang = s && s.uiLang;
        if (lang !== 'ko' && lang !== 'en') { resolve(); return; }
        chrome.runtime.sendMessage({ type: 'get-messages', lang: lang }, function (res) {
          void chrome.runtime.lastError;
          if (res && res.ok) dict = res.messages;
          resolve();
        });
      });
    } catch (e) { resolve(); }
  });

  window.__hwpMsg = function (key, fallback) {
    if (dict && dict[key]) return dict[key];
    try { var m = chrome.i18n.getMessage(key); if (m) return m; } catch (e) { /* noop */ }
    return fallback;
  };
})();
