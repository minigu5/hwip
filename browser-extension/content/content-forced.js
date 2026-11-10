'use strict';
/*
 * 강제 적용 origin 표시 + 원본 소스 백업 추출.
 *
 * 1) __hwpForceFullCompat 플래그 — content.js 의 셀렉터/추출 경로를 확장 모드로 켠다.
 * 2) Markdown Viewer 같은 확장이 KaTeX 로 렌더만 하고 <annotation> 같은 원본 LaTeX
 *    노드를 남기지 않으면 content.js 의 textContent 폴백이 시각 문자(λ, π, ⁡ 등)를
 *    뱉는다. 이 파일은 페이지 URL이 .md/.markdown/.tex 등 raw 소스 가능성이 높을 때
 *    background를 통해 원문을 받아와 $$..$$ / \[..\] / \(..\) / $..$ 블록을 추출,
 *    문서 순서대로 window.__hwpRawMathSources 에 저장한다. content.js 는 호버 시
 *    수식 컨테이너의 인덱스를 계산해 같은 자리의 raw LaTeX 를 꺼내 변환한다.
 */
(function () {
  window.__hwpForceFullCompat = true;

  // 이미 한 번 시도했으면 중복 실행 방지
  if (window.__hwpRawSourceTried) return;
  window.__hwpRawSourceTried = true;

  // URL 이 raw 소스 일 가능성이 있는 확장자인지
  function looksLikeRawSource(url) {
    try {
      var u = new URL(url);
      // chrome-extension:// 등은 우리가 못 가져오니 패스
      if (u.protocol !== 'file:' && u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return /\.(md|markdown|mdown|mkd|txt|tex|ltx)([?#]|$)/i.test(u.pathname);
    } catch (e) { return false; }
  }

  if (!looksLikeRawSource(location.href)) return;

  // ── Markdown 본문에서 수식 블록을 순서대로 추출 ──────────────────
  // 코드 펜스(```..```) / 인라인 코드(`..`) 안의 $는 수식이 아니므로 건너뛴다.
  // $..$ 인라인은 단순 금액(`$100$`)을 피하려고 숫자뿐인 케이스는 제외.
  function parseMathBlocks(md) {
    var blocks = [];
    var i = 0, n = md.length;
    while (i < n) {
      // ``` 코드 펜스
      if (md.charCodeAt(i) === 96 /* ` */ && md.substr(i, 3) === '```') {
        var endFence = md.indexOf('```', i + 3);
        i = endFence < 0 ? n : endFence + 3;
        continue;
      }
      // ` 인라인 코드
      if (md.charCodeAt(i) === 96) {
        var endTick = md.indexOf('`', i + 1);
        i = endTick < 0 ? n : endTick + 1;
        continue;
      }
      // $$..$$ 디스플레이
      if (md.charCodeAt(i) === 36 /* $ */ && md.charCodeAt(i + 1) === 36) {
        var end = md.indexOf('$$', i + 2);
        if (end > i + 2) {
          blocks.push({ type: 'display', src: md.slice(i + 2, end).trim() });
          i = end + 2;
          continue;
        }
        i += 2; continue;
      }
      // $..$ 인라인
      if (md.charCodeAt(i) === 36) {
        // 줄바꿈 전에 닫는 $ 가 있어야 인라인으로 본다
        var j = i + 1;
        while (j < n) {
          var c = md.charCodeAt(j);
          if (c === 10 /* \n */) { j = -1; break; }
          if (c === 92 /* \ */) { j += 2; continue; } // \$ 이스케이프 건너뜀
          if (c === 36) break;
          j++;
        }
        if (j > i + 1 && md.charCodeAt(j) === 36) {
          var inner = md.slice(i + 1, j);
          // 금액 패턴 제외: 숫자/콤마/공백/마침표만
          if (!/^\s*[\d,.\s]+\s*$/.test(inner) && inner.trim().length > 0) {
            blocks.push({ type: 'inline', src: inner.trim() });
          }
          i = j + 1;
          continue;
        }
      }
      // \[..\]
      if (md.charCodeAt(i) === 92 && md.charCodeAt(i + 1) === 91 /* [ */) {
        var endB = md.indexOf('\\]', i + 2);
        if (endB > i + 2) {
          blocks.push({ type: 'display', src: md.slice(i + 2, endB).trim() });
          i = endB + 2;
          continue;
        }
      }
      // \(..\)
      if (md.charCodeAt(i) === 92 && md.charCodeAt(i + 1) === 40 /* ( */) {
        var endP = md.indexOf('\\)', i + 2);
        if (endP > i + 2) {
          blocks.push({ type: 'inline', src: md.slice(i + 2, endP).trim() });
          i = endP + 2;
          continue;
        }
      }
      i++;
    }
    return blocks;
  }

  // background 를 통해 raw 소스 fetch
  try {
    chrome.runtime.sendMessage({ type: 'fetch-text', url: location.href }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.text) return;
      var blocks = parseMathBlocks(resp.text);
      if (blocks.length === 0) return;
      window.__hwpRawMathSources = blocks;
    });
  } catch (e) { /* sendMessage 불가 환경 — 폴백 동작 유지 */ }
})();
