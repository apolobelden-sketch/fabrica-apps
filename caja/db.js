// Caja Guizar · almacenamiento en el teléfono (IndexedDB). Todo funciona sin internet.
const DB = (() => {
  const NOMBRE = "caja-guizar", VERSION = 1;
  const TABLAS = ["productos", "clientes", "ventas", "movimientos", "cortes", "ajustes"];
  let db = null;
  function abrir() {
    return new Promise((ok, mal) => {
      const r = indexedDB.open(NOMBRE, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const t of TABLAS) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: "id" });
      };
      r.onsuccess = () => { db = r.result; ok(db); };
      r.onerror = () => mal(r.error);
    });
  }
  function tx(tabla, modo, fn) {
    return new Promise((ok, mal) => {
      const t = db.transaction(tabla, modo), s = t.objectStore(tabla);
      const res = fn(s);
      t.oncomplete = () => ok(res instanceof IDBRequest ? res.result : res);
      t.onerror = () => mal(t.error); t.onabort = () => mal(t.error);
    });
  }
  const todos = (tabla) => tx(tabla, "readonly", (s) => s.getAll());
  const guardar = (tabla, obj) => tx(tabla, "readwrite", (s) => { s.put(obj); return obj; });
  const guardarVarios = (tabla, lista) => tx(tabla, "readwrite", (s) => { for (const o of lista) s.put(o); return lista.length; });
  const borrar = (tabla, id) => tx(tabla, "readwrite", (s) => s.delete(id));
  const vaciar = (tabla) => tx(tabla, "readwrite", (s) => s.clear());
  // Guarda varias tablas en una sola operación: o se guarda todo o nada (para ventas: venta + inventario + fiado)
  function lote(cambios) {
    const tablas = [...new Set(cambios.map((c) => c[0]))];
    return new Promise((ok, mal) => {
      const t = db.transaction(tablas, "readwrite");
      for (const [tabla, accion, obj] of cambios) { const s = t.objectStore(tabla); if (accion === "borrar") s.delete(obj); else s.put(obj); }
      t.oncomplete = () => ok(true); t.onerror = () => mal(t.error); t.onabort = () => mal(t.error);
    });
  }
  return { abrir, todos, guardar, guardarVarios, borrar, vaciar, lote, TABLAS };
})();
