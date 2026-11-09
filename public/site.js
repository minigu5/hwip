/* 안내 페이지 공통 스크립트: 다크 모드 토글, 복사 버튼, KaTeX 렌더, Service Worker 등록. */
(function () {
  /* 다크 모드 토글 — index.html과 같은 동작. 저장값이 없으면 시스템 테마를 따른다. */
  var btn = document.getElementById('themeToggle');
  if (btn) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function (dark) {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    };
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    var dark = saved ? saved === 'dark' : mq.matches;
    apply(dark);
    mq.addEventListener('change', function (e) {
      var pinned = null;
      try { pinned = localStorage.getItem('theme'); } catch (err) {}
      if (pinned) return;
      dark = e.matches;
      apply(dark);
    });
    btn.addEventListener('click', function () {
      dark = !dark;
      apply(dark);
      try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    });
  }

  /* 복사 버튼: data-copy-target="#id" 요소의 textContent를 복사 */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy-target]');
    if (!b) return;
    var el = document.querySelector(b.getAttribute('data-copy-target'));
    if (!el) return;
    var label = b.textContent;
    navigator.clipboard.writeText(el.textContent).then(function () {
      b.textContent = '복사됨';
      setTimeout(function () { b.textContent = label; }, 1200);
    }).catch(function () {});
  });

  /* data-latex 속성을 가진 요소를 KaTeX로 렌더 (katex는 defer로 로드됨) */
  window.addEventListener('DOMContentLoaded', function () {
    if (!window.katex) return;
    document.querySelectorAll('[data-latex]').forEach(function (el) {
      try {
        window.katex.render(el.getAttribute('data-latex'), el, { displayMode: true, throwOnError: false });
      } catch (e) {}
    });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
