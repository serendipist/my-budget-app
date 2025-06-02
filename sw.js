// sw.js
const CACHE_NAME = 'kakeibo-pwa-gh-v1'; // GitHub Pages용 새 캐시 이름 (변경 시 버전업)
const CACHE_STATIC = 'static-v1';
const CACHE_API    = 'api-cache-v1';
// URLS_TO_CACHE: GitHub Pages에 배포될 파일들의 상대 경로입니다.
// index.html, style.css, app.js, manifest.json 파일이 모두 루트에 있고,
// 아이콘은 'icons' 폴더 안에 있다고 가정합니다.
const URLS_TO_CACHE = [
  './',                 // 사이트의 루트 (보통 index.html을 로드)
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
  // 필요한 다른 정적 파일 (예: 다른 이미지, 폰트 파일 등)이 있다면 여기에 추가합니다.
];

// 서비스 워커 설치 단계: 필수 리소스를 캐싱합니다.
self.addEventListener('install', event => {
  console.log('[SW] Install event, CACHE_NAME:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching initial assets:', URLS_TO_CACHE);
        return cache.addAll(URLS_TO_CACHE).catch(error => {
          console.error('[SW] Failed to cache all initial assets:', error);
          // 하나라도 실패하면 addAll 전체가 실패합니다.
          // 중요한 에셋이 아니라면 개별 cache.add()와 catch로 처리하여 유연성을 높일 수 있습니다.
        });
      })
      .catch(error => {
        console.error('[SW] Cache open failed during install:', error);
      })
  );
  self.skipWaiting(); // 새 서비스 워커가 설치되면 즉시 활성화되도록 합니다.
});

// 서비스 워커 활성화 단계: 이전 버전의 캐시를 정리합니다.
self.addEventListener('activate', event => {
  console.log('[SW] Activate event, CACHE_NAME:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Old caches deleted. Claiming clients.');
      return self.clients.claim(); // 활성화된 서비스 워커가 즉시 페이지 제어권을 갖도록 합니다.
    })
  );
});

// 네트워크 요청 가로채기 (Fetch 이벤트)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  /* ── A. Apps Script GET 요청 → stale-while-revalidate ───────────── */
  const isAppsScriptGet =
    req.method === 'GET' &&
    url.hostname === 'script.google.com' &&
    url.pathname.startsWith('/macros/s/');

  if (isAppsScriptGet) {
    event.respondWith(
      caches.open(CACHE_API).then(async cache => {
        const cached = await cache.match(req);           // ① 캐시 우선
        const fetchPromise = fetch(req)                  // ② 백그라운드 갱신
          .then(resp => { if (resp.ok) cache.put(req, resp.clone()); return resp; })
          .catch(() => cached || Response.error());      // 오프라인이면 캐시라도
        return cached || fetchPromise;                   // 캐시 hit? 즉시 반환 : 아니면 네트워크
      })
    );
    return; // 아래 static 분기로 내려가지 않게 종료
  }

  /* ── B. 그 외 정적 자원 → cache-first ──────────────────────────── */
  event.respondWith(
    caches.match(req).then(cached => cached ||
      fetch(req).then(resp => {
        if (resp.ok && req.method === 'GET') {
          caches.open(CACHE_STATIC).then(c => c.put(req, resp.clone()));
        }
        return resp;
      }))
  );
});
