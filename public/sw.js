// Service Worker — Food Bot Admin Notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

// Message from page → show notification
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NEW_ORDER') {
    const orders = event.data.orders || [];
    const body = orders.map(o => `#${o.order_number} — Rs.${o.total} — ${o.customer_name || 'Customer'}`).join('\n');

    self.registration.showNotification('New Order Aaya!', {
      body: body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
      tag: 'new-order-' + Date.now(),
      actions: [
        { action: 'view', title: 'View Orders' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    });
  }
});

// Notification click → open admin page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Admin tab already open? Focus it
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new admin tab
      return self.clients.openWindow('/admin');
    })
  );
});
