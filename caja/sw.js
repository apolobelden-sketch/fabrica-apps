// Caja Guizar: guarda la app en el teléfono para que abra y venda sin internet.
const VERSION = "caja-v1";
const APP = ["./", "./index.html", "./app.js", "./db.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("caja-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  // Archivos de la app: primero internet (para recibir mejoras), si no hay, la copia guardada
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((k) => k.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"))));
    return;
  }
  // Letra de los títulos: se guarda la primera vez
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
  }
});
