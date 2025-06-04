/* ──────────────────────────────────────────────────────────
   sw.js  –  PWA 서비스-워커
   • CACHE_NAME : “설치-패키지” 캐시 (index.html, JS, CSS …)
   • CACHE_STATIC : 기타 정적 리소스용 서브-캐시
   • CACHE_API : Apps Script GET 응답을 stale-while-revalidate
   수정(배포)할 때마다 CACHE_NAME 의 끝 버전 숫자를 꼭 올려 주세요!
   ────────────────────────────────────────────────────────── */

const CACHE_NAME   = 'kakeibo-pwa-gh-v2';   // ← v1 → v2 로 업데이트
const CACHE_STATIC = 'static-v2';
const CACHE_API    = 'api-cache-v2';

const URLS_TO_CACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // 필요한 다른 정적 파일이 있다면 여기 추가
];

/* =============== 설치 단계 =============== */
self.addEventListener('install', e => {
  console.log('[SW] install – cache core assets');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .catch(err => console.error('[SW] cache.addAll failed:', err))
  );
  self.skipWaiting();   // 새 SW 즉시 활성화
});

/* =============== activate : 옛 캐시 정리 =============== */
self.addEventListener('activate', e => {
  console.log('[SW] activate – clear old caches');
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => (k !== CACHE_NAME && k !== CACHE_STATIC && k !== CACHE_API) && caches.delete(k))
      )
    ).then(() => self.clients.claim())    // 모든 탭에 새 SW 적용
  );
});

/* =============== fetch 가로채기 =============== */
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  /* ---------- A. Apps Script GET 요청 (macros/s/…) ---------- */
  const isAppsScriptGet =
        req.method === 'GET' &&
        url.hostname === 'script.google.com' &&
        url.pathname.startsWith('/macros/s/');

  /* Apps Script 호출만 캐싱 로직 적용 */
  if (isAppsScriptGet) {
    e.respondWith(
      caches.open(CACHE_API).then(async cache => {

        /* ① 캐시 우선 반환 */
        const cached = await cache.match(req);

        /* ② 백그라운드로 네트워크 갱신 */
        const fetchPromise = fetch(req, { cache: 'no-store' })
          .then(async resp => {
            if (resp.ok) {
              const cloneForParse = resp.clone();
              const cloneForCache = resp.clone();

              try {
                // 빈 배열이면 캐시 저장 스킵
                const json = await cloneForParse.json();
                if (!Array.isArray(json) || json.length !== 0) {
                  await cache.put(req, cloneForCache);
                }
              } catch (_) {
                // JSON 파싱 실패 → 그냥 캐시
                await cache.put(req, cloneForCache);
              }
            }
            return resp;
          })
          .catch(() => cached || Response.error());

        /* 캐시 hit 있으면 즉시 반환, 없으면 네트워크 응답 */
        return cached || fetchPromise;
      })
    );
    return; /* 다른 정적 자원 분기로 내려가지 않음 */
  }

  /* ---------- B. 그 외 정적 자원 (예: Cache First 전략) ---------- */
  e.respondWith(
    caches.match(req).then(cachedResponse => {
      // 1. 캐시에 응답이 있으면 즉시 반환
      if (cachedResponse) {
        // console.log('[SW] Serving from static cache:', req.url);
        return cachedResponse;
      }

      // 2. 캐시에 없으면 네트워크로 요청
      return fetch(req).then(networkResponse => {
        // 2a. (선택 사항) 네트워크에서 성공적으로 가져온 응답을 다음 사용을 위해 캐시에 저장
        //      어떤 종류의 응답을, 어떤 캐시에 저장할지는 앱의 필요에 따라 결정합니다.
        //      예를 들어, 성공적인 GET 요청만 특정 정적 캐시에 저장할 수 있습니다.
        if (networkResponse && networkResponse.ok && req.method === 'GET') {
          // const CACHE_STATIC_NAME = 'static-assets-v1'; // 정적 자원용 캐시 이름
          // caches.open(CACHE_STATIC_NAME).then(cache => {
          //   cache.put(req, networkResponse.clone()); // 응답을 복제해서 캐시에 저장
          // });
        }
        return networkResponse; // 네트워크에서 받은 응답 반환
      }).catch(error => {
        // 3. 네트워크 요청도 실패한 경우 (예: 완전 오프라인)
        console.error('[SW] Fetch failed for static asset; returning fallback or error:', req.url, error);
        // 여기에 fallback 로직을 추가할 수 있습니다.
        // 예: if (req.destination === 'document') { return caches.match('/offline.html'); }
        // 지금은 간단히 아무것도 반환하지 않거나, Response.error()를 반환하여 브라우저 기본 오류를 따르게 할 수 있습니다.
        // return Response.error(); // 또는 특정 fallback 페이지
      });
    })
  );
});
