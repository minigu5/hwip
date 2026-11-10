'use strict';

/* Convert a browser selection containing rendered math into a Hwip fragment.
 * The Windows companion replaces this short-lived marker with Hwp Native data.
 */
(function () {
  if (window.__hwipMixedCopyInjected) return;
  window.__hwipMixedCopyInjected = true;

  var API_URL = 'https://hwip.dshs.dev/api/convert';
  var PREFIX = 'HWIP_FRAGMENT_V1:';
  var MATH_SELECTOR = '.katex, mjx-container, math, [data-math], [data-math-source], ms-katex';
  var BLOCK_TAGS = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DIV|H[1-6]|HR|LI|P|PRE|SECTION|TR)$/;

  function latexOf(el) {
    var data = el.closest && el.closest('[data-math],[data-math-source]');
    if (data) return (data.getAttribute('data-math') || data.getAttribute('data-math-source') || '').trim();
    var annotation = el.querySelector && el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) return (annotation.textContent || '').trim();
    var script = el.querySelector && el.querySelector('script[type^="math/tex"]');
    if (script) return (script.textContent || '').trim();
    return (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alttext')) || '').trim();
  }

  function push(segments, type, value) {
    if (!value) return;
    var last = segments[segments.length - 1];
    if (last && last.type === type && type === 'text') last.value += value;
    else segments.push({ type: type, value: value });
  }

  function extractSelection() {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    var root = selection.getRangeAt(0).cloneContents();
    if (!root.querySelector || !root.querySelector(MATH_SELECTOR)) return null;
    var segments = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        push(segments, 'text', node.nodeValue || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
        return;
      }
      var el = node;
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.getAttribute('aria-hidden') === 'true') return;
      if (el.matches(MATH_SELECTOR)) {
        var latex = latexOf(el);
        if (latex) push(segments, 'latex', latex);
        return;
      }
      if (el.tagName === 'BR') {
        push(segments, 'text', '\n');
        return;
      }
      for (var child = el.firstChild; child; child = child.nextSibling) walk(child);
      if (BLOCK_TAGS.test(el.tagName)) push(segments, 'text', '\n');
    }

    walk(root);
    while (segments.length && segments[0].type === 'text' && !segments[0].value) segments.shift();
    return segments.some(function (s) { return s.type === 'latex'; }) ? segments : null;
  }

  function convert(latex) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex: latex })
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      if (!data.result) throw new Error('empty conversion');
      return data.result;
    });
  }

  function encodeFragment(segments) {
    var json = JSON.stringify({ segments: segments });
    var bytes = new TextEncoder().encode(json);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return PREFIX + btoa(binary);
  }

  document.addEventListener('copy', function (event) {
    var source = extractSelection();
    if (!source) return;

    // Keep a readable fallback while conversion runs. The companion ignores it.
    event.preventDefault();
    event.clipboardData.setData('text/plain', window.getSelection().toString());

    Promise.all(source.map(function (segment) {
      if (segment.type !== 'latex') return Promise.resolve(segment);
      return convert(segment.value).then(function (hwp) {
        return { type: 'equation', value: hwp };
      });
    })).then(function (segments) {
      return navigator.clipboard.writeText(encodeFragment(segments));
    }).catch(function (error) {
      console.warn('[Hwip] mixed selection conversion failed:', error);
    });
  }, true);
})();
