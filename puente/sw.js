// Puente Guizar: recibe lo que el usuario comparte desde Android (menú Compartir) y lo deja listo para la página.
const CAJA = "puente-recibido";
const APP = "puente-app-v1";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("puente-app-") && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Lo que llega desde "Compartir"
  if (e.request.method === "POST" && url.pathname.endsWith("/recibir")) {
    e.respondWith((async () => {
      try {
        const datos = await e.request.formData();
        const caja = await caches.open(CAJA);
        await caja.delete("imagen"); await caja.delete("texto");
        const archivo = datos.get("imagen");
        if (archivo && archivo.size) await caja.put("imagen", new Response(archivo, { headers: { "Content-Type": archivo.type || "image/jpeg" } }));
        const texto = [datos.get("titulo"), datos.get("texto"), datos.get("enlace")].filter(Boolean).join(" ").trim();
        if (texto) await caja.put("texto", new Response(texto));
      } catch (_) { /* si falla, la página avisa que no llegó nada */ }
      return Response.redirect("./?compartida=1", 303);
    })());
    return;
  }
  // Página: primero internet, si no hay, la copia guardada
  if (e.request.method === "GET" && url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(APP).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
