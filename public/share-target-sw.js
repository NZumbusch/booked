/*
 * Receives images shared to Booked from other apps (Android: long-press an image in Google Images ›
 * Share › Booked). Imported into the generated service worker. The image waits in a cache until the
 * app picks it up on #/shared and you choose which book it's the cover of.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    const back = new URL('./#/shared', self.registration.scope).href;
    try {
      const form = await event.request.formData();
      const file = form.getAll('image').find((f) => f && typeof f === 'object' && f.size);
      const cache = await caches.open('booked-shared');
      if (file) await cache.put('shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } }));
      else await cache.delete('shared-image');
      const info = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', at: Date.now() };
      await cache.put('shared-info', new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } }));
    } catch {
      // nothing usable arrived: the page says so
    }
    return Response.redirect(back, 303);
  })());
});
