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

  /* 고정 헤더: 스크롤되면 구분선 표시 */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-stuck', window.scrollY > 0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 목차 사이드바: 지금 화면 위쪽에 있는 섹션의 링크를 강조 */
  var tocLinks = document.querySelectorAll('.side-toc a[href^="#"]');
  if (tocLinks.length) {
    var targets = [];
    tocLinks.forEach(function (a) {
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      if (sec) targets.push({ link: a, sec: sec });
    });
    var spy = function () {
      var line = 140;  // 고정 헤더 바로 아래 기준선
      var current = targets[0];
      targets.forEach(function (t) { if (t.sec.getBoundingClientRect().top <= line) current = t; });
      // 맨 아래까지 내리면 마지막 섹션
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = targets[targets.length - 1];
      targets.forEach(function (t) { t.link.classList.toggle('active', t === current); });
    };
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    spy();
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
