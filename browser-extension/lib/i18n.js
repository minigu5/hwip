'use strict';
/*
 * 확장 UI 다국어 헬퍼 — popup / sidepanel 공용
 *
 * - window.hwpT(key)       : 번역문 조회 (실패 시 key 반환)
 * - window.hwpI18nApply()  : HTML 의 data-i18n* 속성을 번역문으로 치환
 *     data-i18n="key"             → textContent
 *     data-i18n-html="key"        → innerHTML (패키지 안 메시지만 사용)
 *     data-i18n-title="key"       → title 속성
 *     data-i18n-placeholder="key" → placeholder 속성
 * - window.hwpI18nReady    : 언어 설정 로드가 끝나면 resolve 되는 Promise
 *
 * 언어는 설정(chrome.storage.sync 의 uiLang: 'auto' | 'ko' | 'en')을 따른다.
 *  - 'auto' : 브라우저 언어 (chrome.i18n.getMessage)
 *  - 'ko'/'en' : _locales/<언어>/messages.json 을 직접 읽어 덮어쓴다.
 *    chrome.i18n 은 브라우저 언어로 고정돼 앱 안에서 바꿀 수 없기 때문이다.
 *
 * 설정 로드가 비동기라 페이지 스크립트는 이 태그의 data-then 속성으로 넘긴다.
 * 로드가 끝나고 번역 치환까지 마친 뒤에야 그 스크립트가 실행되므로, 페이지가
 * 써 넣는 동적 문구를 번역문이 덮어쓰지 않는다. (data-then 스크립트가 있으면
 * 다른 정적 스크립트들보다 뒤, body 맨 끝에 이 태그를 둘 것.)
 *
 * 메시지는 _locales/<언어>/messages.json 에 있다. 새 문자열을 추가하면
 * ko(기본 언어)와 en 둘 다에 넣을 것.
 */
(function (g) {
  var LANGS = ['ko', 'en'];
  var dict = null; // 언어를 직접 골랐을 때만 채워진다: { key: message }
  var lang = null;
  var pageScript = document.currentScript && document.currentScript.dataset.then; // 동기 실행 중에만 잡힌다

  function t(key) {
    if (dict && dict[key]) return dict[key];
    try {
      var m = chrome.i18n.getMessage(key);
      if (m) return m;
    } catch (e) { /* chrome.i18n 없는 환경 */ }
    return key;
  }

  function apply(root) {
    root = root || document;
    var map = [
      ['[data-i18n]', 'i18n', function (el, v) { el.textContent = v; }],
      ['[data-i18n-html]', 'i18nHtml', function (el, v) { el.innerHTML = v; }],
      ['[data-i18n-title]', 'i18nTitle', function (el, v) { el.setAttribute('title', v); }],
      ['[data-i18n-placeholder]', 'i18nPlaceholder', function (el, v) { el.setAttribute('placeholder', v); }]
    ];
    map.forEach(function (m) {
      var els = root.querySelectorAll(m[0]);
      for (var i = 0; i < els.length; i++) m[2](els[i], t(els[i].dataset[m[1]]));
    });
    try {
      var ui = lang || chrome.i18n.getUILanguage();
      if (ui) document.documentElement.lang = ui;
    } catch (e) { /* noop */ }
  }

  // messages.json → { key: message }. chrome.i18n.getMessage 처럼 '$$' 는 '$' 로 푼다.
  function loadDict(code) {
    return fetch(chrome.runtime.getURL('_locales/' + code + '/messages.json'))
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var out = {};
        Object.keys(json).forEach(function (k) {
          out[k] = String(json[k].message).replace(/\$\$/g, '$');
        });
        return out;
      });
  }

  function readSetting() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get({ uiLang: 'auto' }, function (s) {
          resolve(s && s.uiLang);
        });
      } catch (e) { resolve('auto'); }
    });
  }

  var ready = readSetting().then(function (code) {
    if (LANGS.indexOf(code) < 0) return;
    return loadDict(code).then(function (d) { dict = d; lang = code; });
  }).catch(function () { /* 실패하면 브라우저 언어로 */ }).then(function () {
    apply();
    if (pageScript) {
      var s = document.createElement('script');
      s.src = pageScript;
      document.body.appendChild(s);
    }
  });

  g.hwpT = t;
  g.hwpI18nApply = apply;
  g.hwpI18nReady = ready;
})(window);
