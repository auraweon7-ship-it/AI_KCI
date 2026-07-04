// 시작페이지 서비스워커 — 셸 캐시 (오프라인 대비)
const CACHE = 'startpage-v1';
const SHELL = ['/', '/index.html', '/universities-map.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// ── 일정 알림 (백그라운드) ──
// 클라이언트가 오늘 알림 목록을 postMessage로 전달 → SW가 예약해 showNotification
let _remindTimers = [];
self.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'schedule-reminders') {
    _remindTimers.forEach(t => clearTimeout(t));
    _remindTimers = [];
    (msg.reminders || []).forEach(r => {
      const delay = r.at - Date.now();
      if (delay > 0 && delay < 24 * 3600 * 1000) {
        _remindTimers.push(setTimeout(() => {
          self.registration.showNotification('📅 일정 알림 (10분 전)', {
            body: r.body, tag: r.id, requireInteraction: false
          });
        }, delay));
      }
    });
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow('/');
  }));
});

// 네트워크 우선, 실패 시 캐시 (항상 최신 유지 + 오프라인 폴백)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
