// Plaza Emprende: copia local de la página y de las fotos para señal débil. Solo controla red.html.
const PAGINA = "plaza-pagina-v1", FOTOS = "plaza-fotos-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(PAGINA).then((c) => c.add("./red.html")).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
function conLimite(promesa, ms) { return Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error("lento")), ms))]); }
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // La página: primero internet (máx. 6 s), si no, la copia guardada
  if (e.request.mode === "navigate" && u.pathname.endsWith("/red.html")) {
    e.respondWith((async () => {
      const caja = await caches.open(PAGINA);
      try { const r = await conLimite(fetch(e.request), 6000); if (r.ok) caja.put("./red.html", r.clone()); return r; }
      catch { return (await caja.match("./red.html")) || fetch(e.request); }
    })());
    return;
  }
  // Fotos de Cloudinary: si ya se bajaron una vez, salen del teléfono sin gastar datos
  if (u.hostname === "res.cloudinary.com") {
    e.respondWith((async () => {
      const caja = await caches.open(FOTOS);
      const ya = await caja.match(e.request);
      if (ya) return ya;
      const r = await fetch(e.request);
      if (r.ok || r.type === "opaque") { caja.put(e.request, r.clone()); caja.keys().then((ks) => { if (ks.length > 150) caja.delete(ks[0]); }); }
      return r;
    })());
  }
});
