/**
 * Dawaee Service Worker — Offline Shell Cache
 * يحفظ ملفات الموقع ويخدمها حتى بدون إنترنت
 */

const CACHE_NAME = 'dawaee-shell-v1';

// ملفات يجب تحميلها عند أول تثبيت
const PRECACHE_URLS = ['/'];

// ========================
// Install: حفظ الملفات
// ========================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// ========================
// Activate: تنظيف الكاشات القديمة
// ========================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ========================
// Fetch: استراتيجية Network First مع Offline Fallback
// ========================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // طلبات API دائماً للسيرفر — لا نكاشها
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    // إذا فشل طلب API بسبب انقطاع النت، نرجع خطأ network واضح
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ message: 'لا يوجد اتصال بالإنترنت', offline: true }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // ملفات الموقع: Network First → Cache Fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // نجح من السيرفر — احفظه في الكاش وأرجعه
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // فشل — ارجع من الكاش
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // إذا ما في كاش (صفحة غير محفوظة) — ارجع الصفحة الرئيسية (SPA fallback)
          return caches.match('/');
        });
      })
  );
});
