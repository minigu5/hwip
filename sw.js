/*
 * 휩 - LaTeX → 한글(HWP) 수식 변환기 Service Worker
 *
 * 첫 방문에서 앱 쉘(HTML/CSS/JS/벤더/폰트)을 캐시에 담아 두고, 이후 새로고침이나
 * 오프라인 상태에서도 같은 자원을 캐시에서 즉시 돌려주어 사이트가 깨지지 않게 한다.
 *
 * 전략 요약:
 *   - 같은 오리진 정적 자원: network-first → 실패 시 캐시 (배포 직후에도 옛 app.js가 돌지 않게)
 *   - 내비게이션 요청: network-first → 실패 시 캐시된 index.html로 폴백 (새로고침 보장)
 *   - CDN(jsdelivr) 자원: cache-first (KaTeX·transformers.js 런타임)
 *   - HuggingFace 모델, Vercel insights, rhwp 등 외부 트래픽: 네트워크 우선·캐시 없음
 *     (OCR 모델 자체는 transformers.js가 자체 Cache Storage에 별도 보관한다)
 *
 * 캐시 이름에 버전을 박아 두고, activate 시 옛 버전은 제거한다. 자원 목록이나 변환
 * 로직을 고칠 때 CACHE_VERSION을 올리면 사용자 브라우저가 새 셸을 받는다.
 */

var CACHE_VERSION = 'v15-2026-11-10-network-first';
// v14까지는 cache-first였고 캐시 이름이 'whip-app-shell-'로 시작했다. 접두어를 바꿔 두면
// 옛 SW가 띄운 페이지(옛 app.js가 돌고 있을 수 있음)가 있을 때만 골라 새로고침할 수 있다.
var CACHE_PREFIX = 'whip-shell-';
var LEGACY_PREFIX = 'whip-app-shell-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

var APP_SHELL = [
  './',
  'index.html',
  'privacy.html',
  'app.js',
  'src/converter.js',
  'src/hwpx-convert.js',
  'src/md-to-hwpx.js',
  'src/ocr-worker.js',
  'vendor/jszip.min.js',
  'templates/blank.hwpx',
  'public/favicon.png',
  'public/logo.svg',
  'public/site.css',
  'public/site.js',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 일부 자원(CDN)이 일시적으로 실패해도 install 자체는 막지 않는다.
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // cache-first 시절 캐시가 있으면 열린 페이지가 옛 app.js로 돌고 있을 수 있어 새로고침을 요청한다.
      // 그 뒤 버전끼리는 network-first라 페이지 코드가 이미 최신이므로 새로고침하지 않는다
      // (받던 OCR 모델이나 인식 결과가 새로고침에 날아가지 않게).
      var hadLegacyCache = keys.some(function (key) { return key.indexOf(LEGACY_PREFIX) === 0; });
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(LEGACY_PREFIX) === 0 || (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME)) {
          return caches.delete(key);
        }
      })).then(function () {
        return self.clients.claim();
      }).then(function () {
        if (!hadLegacyCache) return;
        return self.clients.matchAll({ type: 'window' }).then(function (clients) {
          clients.forEach(function (c) { c.postMessage({ type: 'SW_UPDATED' }); });
        });
      });
    })
  );
});

// 캐시하지 않는 호스트(인터넷 연결이 있을 때만 동작하는 외부 자원)
function isBypassed(url) {
  return (
    url.hostname.indexOf('huggingface.co') !== -1 ||
    url.hostname.indexOf('hf.co') !== -1 ||
    url.pathname.indexOf('/_vercel/') === 0 ||
    url.hostname.indexOf('vitals.vercel-insights.com') !== -1 ||
    url.hostname.indexOf('vercel-scripts.com') !== -1 ||
    url.hostname.indexOf('vercel.app') !== -1 && url.hostname !== self.location.hostname
  );
}

function isCdnShell(url) {
  return url.hostname === 'cdn.jsdelivr.net';
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isBypassed(url)) return; // 기본 네트워크 동작 그대로

  // 내비게이션 요청 → 새로고침 시에도 오프라인에서 셸을 띄울 수 있도록 캐시 폴백
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        // 정상 응답이면 캐시에도 한 부 두고 그대로 반환
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy).catch(function () {}); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isCdnShell(url)) return; // 그 외 외부 자원은 손대지 않음

  // 같은 오리진: network-first. cache-first면 배포 직후 첫 방문에서 새 index.html과 옛 app.js가
  // 섞여 돌고(옛 OCR 모델을 받기 시작했다가 SW 갱신 새로고침에 날아감), 새 SW가 깔린 뒤에야 바뀐다.
  // HTTP 캐시가 ETag로 재검증하므로 바뀌지 않은 파일은 304로 가볍게 끝난다. 오프라인이면 캐시.
  if (sameOrigin) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy).catch(function () {}); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // CDN(버전 고정 URL): cache-first. 캐시에 있으면 즉시 반환, 없으면 네트워크 후 캐시에 적재
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        // 부분 응답(206)이나 오류는 캐시하지 않는다
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy).catch(function () {}); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
