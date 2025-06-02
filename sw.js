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

  if (isAppsScriptGet) {
    e.respondWith(
      caches.open(CACHE_API).then(async cache => {
        /* ① 캐시 선반환 */
        const cached = await cache.match(req);
        /* ② 백그라운드로 최신 데이터 가져와 캐시 교체 */
        const refresh = fetch(req, { cache: 'no-store' })
          .then(resp => { if (resp.ok) cache.put(req, resp.clone()); return resp; })
          .catch(() => cached || Response.error());

        /* 캐시가 있으면 즉시 화면에, 없으면 네트워크 응답 */
        return cached || refresh;
      })
    );
    return;   // 밑의 정적 자원 분기 막기
  }

  /* ---------- B. 그 외 정적 파일 : cache-first ---------- */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      if (resp.ok && req.method === 'GET') {
        caches.open(CACHE_STATIC).then(c => c.put(req, resp.clone()));
      }
      return resp;
    }))
  );
});
