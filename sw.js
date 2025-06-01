// sw.js
const CACHE_NAME = 'kakeibo-pwa-gh-v1'; // GitHub Pages용 새 캐시 이름 (변경 시 버전업)

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
  const request = event.request;

  // API 호출 (google.script.run 또는 Apps Script Web API URL)은 캐시하지 않고 항상 네트워크로 보냅니다.
  // 실제 Apps Script API URL 패턴에 맞게 이 조건을 수정해야 합니다.
  // 예를 들어, Apps Script 웹앱 URL이 'script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec' 이라면,
  if (request.url.startsWith('https://script.google.com/macros/s/')) { // Apps Script API 호출로 간주
    // console.log('[SW] API call, bypassing cache (network first):', request.url);
    event.respondWith(
      fetch(request).catch(error => {
        console.warn('[SW] API fetch failed (returning generic error or offline indicator if any):', request.url, error);
        // API 호출 실패 시 오프라인 대체 응답을 제공할 수 있습니다. (예: '오프라인입니다' JSON 응답)
        // return new Response(JSON.stringify({ error: 'offline' }), { headers: { 'Content-Type': 'application/json' }});
      })
    );
    return;
  }

  // 그 외 정적 자원 등: "Cache First, then Network" (캐시 우선, 없으면 네트워크 요청 후 캐싱)
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // console.log('[SW] Serving from cache:', request.url);
          return cachedResponse; // 캐시에 있으면 캐시된 응답 반환
        }

        // console.log('[SW] Fetching from network:', request.url);
        return fetch(request).then(
          networkResponse => {
            // GET 요청이고, 유효한 응답(200 OK)이며, chrome-extension이 아닌 경우에만 캐싱
            if (networkResponse && networkResponse.status === 200 && request.method === 'GET' && !request.url.startsWith('chrome-extension://')) {
              // console.log('[SW] Caching new resource:', request.url);
              const responseToCache = networkResponse.clone(); // 응답은 한 번만 사용 가능하므로 복제
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, responseToCache);
                });
            }
            return networkResponse; // 네트워크 응답 반환
          }
        ).catch(error => {
          console.warn('[SW] Network fetch failed, no cache hit:', request.url, error);
          // 여기서 오프라인 대체 페이지나 이미지를 반환할 수 있습니다.
          // 예: if (request.destination === 'image') return caches.match('/icons/offline-icon.png');
          // 예: return caches.match('/offline.html');
        });
      })
  );
});