/* This worker owns only this extension's directory. It never intercepts requests. */
self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        let target;
        try {
            target = new URL(event.notification.data?.url);
        } catch {
            return;
        }
        if (!['http:', 'https:'].includes(target.protocol) || target.origin !== self.location.origin || target.username || target.password) return;
        target.search = '';
        target.hash = '';
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            const existing = new URL(client.url);
            if (existing.origin === target.origin && existing.pathname === target.pathname) {
                await client.focus();
                return;
            }
        }
        await self.clients.openWindow(target.href);
    })());
});
