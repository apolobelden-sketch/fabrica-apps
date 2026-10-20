// Caja Guizar · punto de venta y fiado para tienditas. Funciona sin internet; los datos viven en el teléfono.
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinero = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dineroCorto = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ahora = () => new Date().toISOString();
const diaDe = (iso) => new Date(iso).toLocaleDateString("en-CA"); // AAAA-MM-DD en la hora del teléfono
const fechaCorta = (iso) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const fechaHora = (iso) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const telLimpio = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length === 10 ? "52" + d : d; };
const telBonito = (t) => { const d = String(t || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : t || ""; };
const PAGOS = { efectivo: "💵 Efectivo", transferencia: "🏦 Transferencia", tarjeta: "💳 Tarjeta", fiado: "📒 Fiado" };

// ---------- Estado ----------
const S = { productos: [], clientes: [], ventas: [], movimientos: [], cortes: [], ajustes: {} };
let tab = "vender", carrito = [], filtroProd = "", catVender = "", filtroLista = "todos", periodo = 7;
try { carrito = JSON.parse(localStorage.getItem("caja_carrito") || "[]"); } catch (e) {}
const guardarCarrito = () => { try { localStorage.setItem("caja_carrito", JSON.stringify(carrito)); } catch (e) {} };
const aj = (k, def) => (S.ajustes[k] !== undefined ? S.ajustes[k] : def);
async function ponerAjuste(k, v) { S.ajustes[k] = v; await DB.guardar("ajustes", { id: k, valor: v }); }

async function cargarTodo() {
  for (const t of DB.TABLAS) {
    const filas = await DB.todos(t);
    if (t === "ajustes") { S.ajustes = {}; for (const f of filas) S.ajustes[f.id] = f.valor; }
    else S[t] = filas;
  }
  S.ventas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  S.movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  S.cortes.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
const producto = (pid) => S.productos.find((p) => p.id === pid);
const cliente = (cid) => S.clientes.find((c) => c.id === cid);
function saldo(cid) {
  let s = 0;
  for (const m of S.movimientos) if (m.clienteId === cid) s += m.tipo === "cargo" ? m.monto : m.tipo === "abono" ? -m.monto : 0;
  return r2(s);
}
const ultimoMov = (cid) => { for (let i = S.movimientos.length - 1; i >= 0; i--) if (S.movimientos[i].clienteId === cid) return S.movimientos[i]; return null; };
const bajoStock = (p) => p.stock !== null && p.stock !== undefined && p.stock !== "" && Number(p.stock) <= Number(p.minimo || 0);

// ---------- Utilidades de pantalla ----------
function avisar(t, ms = 2400) { const a = $("aviso"); a.textContent = t; a.classList.add("ver"); clearTimeout(avisar.t); avisar.t = setTimeout(() => a.classList.remove("ver"), ms); }
function abrirModal(titulo, html, alAbrir) {
  $("modalTit").textContent = titulo; $("modalCuerpo").innerHTML = html;
  const d = $("modal"); if (!d.open) d.showModal();
  if (alAbrir) alAbrir($("modalCuerpo"));
}
const cerrarModal = () => { if ($("modal").open) $("modal").close(); };
$("modalCerrar").onclick = cerrarModal;
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) cerrarModal(); });
function pitido() {
  try { const c = pitido.c || (pitido.c = new (window.AudioContext || window.webkitAudioContext)()); const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1600; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.09); } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(60);
}
async function compartirImagen(canvas, nombre, texto) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
  const f = new File([blob], nombre, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], text: texto }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = nombre; a.click(); avisar("Imagen guardada en tu teléfono");
}
function abrirWhatsApp(tel, texto) { const n = telLimpio(tel); window.open(`https://wa.me/${n}?text=${encodeURIComponent(texto)}`, "_blank"); }

// ---------- Escáner de códigos con la cámara ----------
const Escaner = (() => {
  let flujo = null, detector = null, alLeer = null, continuo = false, ultimo = { c: "", t: 0 }, activo = false;
  async function abrir(cb, modoContinuo) {
    alLeer = cb; continuo = !!modoContinuo;
    if (!("BarcodeDetector" in window)) { teclear(); return; }
    try {
      detector = detector || new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] });
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
    } catch (e) { avisar("No pude abrir la cámara. Teclea el código."); teclear(); return; }
    const v = $("video"); v.srcObject = flujo; await v.play().catch(() => {});
    $("escaner").classList.add("abierto"); $("ultimoEscaneo").classList.remove("ver"); activo = true; ciclo();
  }
  async function ciclo() {
    if (!activo) return;
    try {
      const v = $("video");
      if (v.readyState >= 2) {
        const r = await detector.detect(v);
        if (r.length) {
          const c = r[0].rawValue, t = Date.now();
          if (c && (c !== ultimo.c || t - ultimo.t > 1800)) {
            ultimo = { c, t }; pitido();
            const msg = alLeer(c);
            if (!continuo) { cerrar(); return; }
            if (msg) { const u = $("ultimoEscaneo"); u.textContent = msg; u.classList.add("ver"); }
          }
        }
      }
    } catch (e) {}
    setTimeout(() => requestAnimationFrame(ciclo), 160);
  }
  function cerrar() { activo = false; if (flujo) flujo.getTracks().forEach((t) => t.stop()); flujo = null; $("escaner").classList.remove("abierto"); }
  function teclear() {
    const c = prompt("Teclea el código de barras:");
    if (c && c.trim()) { const msg = alLeer(c.trim()); if (msg && continuo) avisar(msg); }
  }
  $("escListo").onclick = cerrar;
  $("escTeclear").onclick = () => teclear();
  return { abrir, cerrar };
})();

// ---------- Navegación ----------
document.querySelectorAll("nav.barra button").forEach((b) => b.onclick = () => irA(b.dataset.tab));
function irA(t) {
  tab = t;
  document.querySelectorAll("nav.barra button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false"));
  pintar(); scrollTo(0, 0);
}
function pintar() {
  const nombre = aj("negocio", "");
  $("tituloNegocio").innerHTML = `${esc(nombre || "Caja Guizar")}<small>${nombre ? "Caja Guizar · " : ""}Punto de venta y fiado</small>`;
  ({ vender: pintarVender, productos: pintarProductos, fiado: pintarFiado, corte: pintarCorte, mas: pintarReportes })[tab]();
  pintarCarrito();
}

// =====================================================================
// VENDER
// =====================================================================
function pintarVender() {
  const v = $("vista");
  if (!S.productos.length) {
    v.innerHTML = `<h2>Bienvenido a tu caja</h2>
      <p class="ayuda" style="margin-bottom:14px">Agrega los productos que vendes con su precio. Si tienen código de barras, escanéalo con la cámara y después vendes solo apuntando al código. Todo se guarda en este teléfono y funciona sin internet.</p>
      <button class="btn prim ancho" id="primerProd">📦 Agregar mi primer producto</button>
      <button class="btn ancho" id="ejemplo" style="margin-top:8px">🧪 Probar con productos de ejemplo</button>
      <button class="btn ancho" id="ventaLibre0" style="margin-top:8px">✍️ Vender sin dar de alta productos</button>`;
    $("primerProd").onclick = () => formProducto();
    $("ejemplo").onclick = cargarEjemplo;
    $("ventaLibre0").onclick = ventaLibre;
    return;
  }
  const cats = [...new Set(S.productos.map((p) => p.categoria).filter(Boolean))].sort();
  const q = normal(filtroProd);
  const lista = S.productos.filter((p) => (!catVender || p.categoria === catVender) && (!q || normal(p.nombre).includes(q) || String(p.codigo || "").includes(filtroProd.trim())))
    .sort((a, b) => (b.vendidos || 0) - (a.vendidos || 0) || a.nombre.localeCompare(b.nombre));
  v.innerHTML = `
    <div class="buscador">
      <input id="buscar" type="search" placeholder="Buscar producto o código" value="${esc(filtroProd)}" aria-label="Buscar producto">
      <button class="btn prim icono" id="escanearVenta" aria-label="Escanear con la cámara">📷</button>
    </div>
    ${cats.length ? `<div class="chips" role="group" aria-label="Categorías"><button class="chip" data-cat="" aria-pressed="${!catVender}">Todo</button>${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${catVender === c}">${esc(c)}</button>`).join("")}</div>` : ""}
    <div class="rejilla">
      ${lista.map((p) => `<button class="prod ${bajoStock(p) ? "bajo" : ""} ${p.stock !== null && p.stock !== "" && Number(p.stock) <= 0 ? "agotado" : ""}" data-pid="${p.id}">
        <span class="n">${esc(p.nombre)}</span><span class="p num">${dineroCorto(p.precio)}</span>
        ${p.stock !== null && p.stock !== "" && p.stock !== undefined ? `<span class="s">${Number(p.stock) <= 0 ? "Agotado" : "Quedan " + Number(p.stock)}</span>` : ""}</button>`).join("")}
      <button class="prod" id="ventaLibre" style="border-style:dashed"><span class="n">✍️ Otro producto</span><span class="s">Precio libre</span></button>
    </div>
    ${!lista.length ? `<p class="ayuda" style="margin-top:12px">No encontré "${esc(filtroProd)}". <button class="btn" id="altaDesdeBusqueda">Agregarlo</button></p>` : ""}
    <div class="relleno-carrito"></div>`;
  const b = $("buscar");
  b.oninput = () => { filtroProd = b.value; const pos = b.selectionStart; pintarVender(); pintarCarrito(); const nb = $("buscar"); nb.focus(); nb.setSelectionRange(pos, pos); };
  b.onkeydown = (e) => { if (e.key === "Enter") { const exacto = S.productos.find((p) => p.codigo && p.codigo === b.value.trim()); if (exacto) { agregar(exacto.id); filtroProd = ""; pintar(); } } };
  $("escanearVenta").onclick = () => Escaner.abrir(leerEnVenta, true);
  v.querySelectorAll("[data-cat]").forEach((c) => c.onclick = () => { catVender = c.dataset.cat; pintarVender(); });
  v.querySelectorAll("[data-pid]").forEach((x) => x.onclick = () => agregar(x.dataset.pid));
  $("ventaLibre").onclick = ventaLibre;
  if ($("altaDesdeBusqueda")) $("altaDesdeBusqueda").onclick = () => formProducto(null, { nombre: filtroProd });
}
function leerEnVenta(codigo) {
  const p = S.productos.find((x) => x.codigo && x.codigo === codigo);
  if (!p) {
    Escaner.cerrar();
    if (confirm(`El código ${codigo} no está en tus productos. ¿Lo agregas ahora?`)) formProducto(null, { codigo });
    return "";
  }
  agregar(p.id, true);
  return `✅ ${p.nombre} · ${dineroCorto(p.precio)} (llevas ${carrito.find((c) => c.pid === p.id)?.cant || 1})`;
}
function agregar(pid, silencioso) {
  const p = producto(pid); if (!p) return;
  const r = carrito.find((c) => c.pid === pid);
  if (r) r.cant = r2(r.cant + 1); else carrito.push({ pid, cant: 1 });
  guardarCarrito(); pintarCarrito();
  if (p.stock !== null && p.stock !== "" && p.stock !== undefined && (carrito.find((c) => c.pid === pid).cant > Number(p.stock)) && !silencioso) avisar(`Ojo: según tu inventario solo quedan ${Number(p.stock)} de ${p.nombre}`);
}
function ventaLibre() {
  abrirModal("Producto con precio libre", `
    <label class="campo"><span>¿Qué es?</span><input id="libNom" placeholder="Ej. Tortillas 1 kg, recarga, varios"></label>
    <div class="fila"><label class="campo"><span>Precio</span><input id="libPre" inputmode="decimal" placeholder="0.00"></label>
    <label class="campo"><span>Cantidad</span><input id="libCan" inputmode="decimal" value="1"></label></div>
    <button class="btn prim ancho" id="libOk">Agregar a la venta</button>`, () => {
    $("libNom").focus();
    $("libOk").onclick = () => {
      const precio = r2($("libPre").value), cant = r2($("libCan").value) || 1;
      if (!(precio > 0)) { avisar("Escribe el precio"); return; }
      carrito.push({ libre: true, nombre: $("libNom").value.trim() || "Varios", precio, cant, pid: "libre-" + nuevoId() });
      guardarCarrito(); cerrarModal(); pintarCarrito();
    };
  });
}
function lineaCarrito(c) {
  if (c.libre) return { nombre: c.nombre, precio: c.precio, costo: null, cant: c.cant };
  const p = producto(c.pid); if (!p) return null;
  return { nombre: p.nombre, precio: Number(p.precio), costo: p.costo === "" || p.costo == null ? null : Number(p.costo), cant: c.cant };
}
const totalCarrito = () => r2(carrito.reduce((s, c) => { const l = lineaCarrito(c); return s + (l ? l.precio * l.cant : 0); }, 0));
function pintarCarrito() {
  let caja = document.querySelector(".carrito");
  carrito = carrito.filter((c) => c.libre || producto(c.pid));
  if (tab !== "vender" || !carrito.length) { if (caja) caja.remove(); return; }
  if (!caja) { caja = document.createElement("section"); caja.className = "carrito"; caja.setAttribute("aria-label", "Venta en curso"); document.body.appendChild(caja); }
  const piezas = carrito.reduce((s, c) => s + c.cant, 0);
  caja.innerHTML = `<div class="lista">${carrito.map((c, i) => { const l = lineaCarrito(c); return `<div class="renglon">
      <div class="nom">${esc(l.nombre)}<small class="num">${dineroCorto(l.precio)} c/u</small></div>
      <div class="cant"><button data-menos="${i}" aria-label="Uno menos">−</button><span class="num" data-cant="${i}" role="button" tabindex="0" aria-label="Cambiar cantidad">${c.cant}</span><button data-mas="${i}" aria-label="Uno más">+</button></div>
      <div class="imp num">${dineroCorto(l.precio * c.cant)}</div></div>`; }).join("")}</div>
    <div class="pie-carrito">
      <div class="tot"><small>${piezas} ${piezas === 1 ? "pieza" : "piezas"} · <button class="btn" id="vaciar" style="padding:2px 8px;font-size:.78rem">Vaciar</button></small><b class="num">${dinero(totalCarrito())}</b></div>
      <button class="btn cobrar" id="cobrar">Cobrar</button>
    </div>`;
  caja.querySelectorAll("[data-mas]").forEach((b) => b.onclick = () => { carrito[b.dataset.mas].cant = r2(carrito[b.dataset.mas].cant + 1); guardarCarrito(); pintarCarrito(); });
  caja.querySelectorAll("[data-menos]").forEach((b) => b.onclick = () => { const c = carrito[b.dataset.menos]; c.cant = r2(c.cant - 1); if (c.cant <= 0) carrito.splice(b.dataset.menos, 1); guardarCarrito(); pintarCarrito(); });
  caja.querySelectorAll("[data-cant]").forEach((s) => s.onclick = () => {
    const c = carrito[s.dataset.cant]; const n = prompt("Cantidad (puedes poner decimales, ej. 1.5 kg):", c.cant);
    if (n === null) return; const v = r2(String(n).replace(",", ".")); if (v > 0) c.cant = v; else carrito.splice(s.dataset.cant, 1); guardarCarrito(); pintarCarrito();
  });
  $("vaciar").onclick = () => { if (confirm("¿Quitar todo lo de esta venta?")) { carrito = []; guardarCarrito(); pintarCarrito(); } };
  $("cobrar").onclick = abrirCobro;
  const relleno = document.querySelector(".relleno-carrito"); if (relleno) relleno.style.height = caja.offsetHeight + 16 + "px";
}

// ---------- Cobrar ----------
function abrirCobro() {
  const total = totalCarrito();
  let pago = "efectivo", clienteSel = null;
  const billetes = [20, 50, 100, 200, 500].filter((b) => b >= total).slice(0, 4);
  abrirModal("Cobrar", `
    <div class="saldo-grande"><small>Total a cobrar</small><b class="cero num">${dinero(total)}</b></div>
    <div class="pagos" role="group" aria-label="Forma de pago">${Object.entries(PAGOS).map(([k, t]) => `<button class="pago" data-pago="${k}" aria-pressed="${k === pago}">${t}</button>`).join("")}</div>
    <div id="zonaEfectivo">
      <label class="campo"><span>¿Con cuánto paga?</span><input id="recibido" inputmode="decimal" placeholder="${total.toFixed(2)}"></label>
      <div class="billetes"><button data-b="${total}">Exacto</button>${billetes.map((b) => `<button data-b="${b}">${dineroCorto(b)}</button>`).join("")}</div>
      <div class="cambio num" id="cambio">Cambio: $0.00</div>
    </div>
    <div id="zonaFiado" hidden>
      <label class="campo"><span>¿A quién se le fía?</span><input id="buscaCli" placeholder="Busca el nombre" autocomplete="off"></label>
      <div id="listaCli"></div>
      <div id="infoCli"></div>
    </div>
    <button class="btn cobrar ancho" id="confirmar">Cobrar ${dinero(total)}</button>`, (m) => {
    const recibido = () => { const v = $("recibido").value.trim(); return v === "" ? total : r2(v.replace(",", ".")); };
    const pintarCambio = () => { const c = r2(recibido() - total); $("cambio").textContent = c < 0 ? `Faltan ${dinero(-c)}` : `Cambio: ${dinero(c)}`; $("cambio").style.color = c < 0 ? "var(--rojo)" : "var(--verde)"; };
    $("recibido").oninput = pintarCambio;
    m.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => { $("recibido").value = b.dataset.b; pintarCambio(); });
    m.querySelectorAll("[data-pago]").forEach((b) => b.onclick = () => {
      pago = b.dataset.pago; m.querySelectorAll("[data-pago]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("zonaEfectivo").hidden = pago !== "efectivo"; $("zonaFiado").hidden = pago !== "fiado";
      if (pago === "fiado") { pintarClientes(); $("buscaCli").focus(); }
    });
    function pintarClientes() {
      const q = normal($("buscaCli").value);
      const l = S.clientes.filter((c) => !q || normal(c.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre)).slice(0, 6);
      $("listaCli").innerHTML = l.map((c) => `<button class="item" data-cli="${c.id}"><span class="t"><b>${esc(c.nombre)}</b><small>Debe ${dinero(saldo(c.id))}${c.limite ? " · límite " + dineroCorto(c.limite) : ""}</small></span><span aria-hidden="true">${clienteSel === c.id ? "✅" : ""}</span></button>`).join("")
        + `<button class="btn ancho" id="cliNuevoCobro" style="margin-bottom:10px">➕ Cliente nuevo${$("buscaCli").value.trim() ? ": " + esc($("buscaCli").value.trim()) : ""}</button>`;
      $("listaCli").querySelectorAll("[data-cli]").forEach((b) => b.onclick = () => { clienteSel = b.dataset.cli; pintarClientes(); infoCliente(); });
      $("cliNuevoCobro").onclick = async () => {
        const nombre = $("buscaCli").value.trim() || prompt("Nombre del cliente:"); if (!nombre) return;
        const tel = prompt("WhatsApp del cliente (10 dígitos, opcional):") || "";
        const c = { id: nuevoId(), nombre, tel: tel.replace(/\D/g, ""), limite: null, creado: ahora() };
        await DB.guardar("clientes", c); S.clientes.push(c); clienteSel = c.id; $("buscaCli").value = nombre; pintarClientes(); infoCliente();
      };
    }
    function infoCliente() {
      const c = cliente(clienteSel); if (!c) { $("infoCli").innerHTML = ""; return; }
      const nuevo = r2(saldo(c.id) + total);
      const pasa = c.limite && nuevo > c.limite;
      $("infoCli").innerHTML = `<div class="alerta ${pasa ? "roja" : ""}">${esc(c.nombre)} debe ${dinero(saldo(c.id))}. Con esta compra quedará en <b>${dinero(nuevo)}</b>.${pasa ? `<br>⚠️ Pasa su límite de ${dinero(c.limite)}.` : ""}</div>`;
    }
    $("buscaCli").oninput = pintarClientes;
    $("confirmar").onclick = async () => {
      if (pago === "efectivo" && recibido() < total) { avisar("Lo recibido no alcanza para el total"); return; }
      if (pago === "fiado") {
        const c = cliente(clienteSel); if (!c) { avisar("Elige a quién se le fía"); return; }
        if (c.limite && r2(saldo(c.id) + total) > c.limite && !confirm(`${c.nombre} pasa su límite de ${dinero(c.limite)}. ¿Fiarle de todos modos?`)) return;
      }
      $("confirmar").disabled = true;
      try { const v = await registrarVenta(pago, pago === "efectivo" ? recibido() : total, clienteSel); ventaHecha(v); }
      catch (e) { $("confirmar").disabled = false; avisar("No se pudo guardar la venta: " + e.message, 4000); }
    };
  });
}
async function registrarVenta(pago, recibido, clienteId) {
  const items = carrito.map((c) => { const l = lineaCarrito(c); return { pid: c.libre ? null : c.pid, nombre: l.nombre, precio: l.precio, costo: l.costo, cant: c.cant }; });
  const total = r2(items.reduce((s, i) => s + i.precio * i.cant, 0));
  const folio = Number(aj("folio", 0)) + 1;
  const venta = { id: nuevoId(), folio, fecha: ahora(), items, total, pago, recibido: r2(recibido), cambio: pago === "efectivo" ? r2(recibido - total) : 0, clienteId: pago === "fiado" ? clienteId : null };
  const cambios = [["ventas", "poner", venta], ["ajustes", "poner", { id: "folio", valor: folio }]];
  const productosCambiados = [];
  for (const i of items) {
    if (!i.pid) continue;
    const p = producto(i.pid); if (!p) continue;
    const nuevo = { ...p, vendidos: r2((p.vendidos || 0) + i.cant) };
    if (p.stock !== null && p.stock !== "" && p.stock !== undefined) nuevo.stock = r2(Number(p.stock) - i.cant);
    cambios.push(["productos", "poner", nuevo]); productosCambiados.push(nuevo);
  }
  let mov = null;
  if (pago === "fiado") { mov = { id: nuevoId(), clienteId, fecha: venta.fecha, tipo: "cargo", monto: total, ventaId: venta.id, concepto: items.map((i) => `${i.cant} ${i.nombre}`).join(", ").slice(0, 140) }; cambios.push(["movimientos", "poner", mov]); }
  await DB.lote(cambios); // todo o nada
  S.ventas.push(venta); S.ajustes.folio = folio;
  for (const n of productosCambiados) { const k = S.productos.findIndex((p) => p.id === n.id); S.productos[k] = n; }
  if (mov) S.movimientos.push(mov);
  carrito = []; guardarCarrito();
  return venta;
}
function ventaHecha(v) {
  const c = v.clienteId ? cliente(v.clienteId) : null;
  abrirModal("Venta registrada", `
    <div class="saldo-grande"><small>Folio ${v.folio} · ${PAGOS[v.pago]}</small><b class="cero num">${dinero(v.total)}</b>
    ${v.pago === "efectivo" ? `<small style="font-size:1.1rem;color:var(--tinta)">Cambio: <b style="display:inline;font-size:1.4rem" class="num">${dinero(v.cambio)}</b></small>` : ""}
    ${c ? `<small style="display:block;margin-top:6px">${esc(c.nombre)} ahora debe <b style="display:inline;font-size:1.1rem;color:var(--rojo)" class="num">${dinero(saldo(c.id))}</b></small>` : ""}</div>
    <button class="btn prim ancho" id="nuevaVenta">🛒 Nueva venta</button>
    <button class="btn ancho" id="ticketWa" style="margin-top:8px">🧾 Mandar ticket</button>
    ${bajos(v).length ? `<div class="alerta" style="margin-top:12px">📦 Se están acabando: ${bajos(v).map((p) => esc(p.nombre) + " (" + Number(p.stock) + ")").join(", ")}</div>` : ""}`, () => {
    $("nuevaVenta").onclick = () => { cerrarModal(); filtroProd = ""; pintar(); };
    $("ticketWa").onclick = () => compartirImagen(dibujarTicket(v), `ticket-${v.folio}.jpg`, `Ticket ${v.folio} · ${aj("negocio", "")} · Total ${dinero(v.total)}`);
  });
  pintar();
}
const bajos = (v) => v.items.map((i) => i.pid && producto(i.pid)).filter((p) => p && bajoStock(p));

// ---------- Ticket como imagen ----------
function lineas(ctx, t, ancho, max) { const out = []; let l = ""; for (const p of String(t).split(/\s+/)) { const x = l ? l + " " + p : p; if (ctx.measureText(x).width > ancho && l) { out.push(l); l = p; } else l = x; } if (l) out.push(l); return out.slice(0, max); }
function dibujarTicket(v) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d"), W = 720;
  ctx.font = "500 30px system-ui, sans-serif";
  const filas = v.items.map((i) => ({ ...i, ls: lineas(ctx, i.nombre, 420, 2) }));
  const H = 420 + filas.reduce((s, f) => s + 24 + f.ls.length * 38, 0) + 260;
  cv.width = W; cv.height = H;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#14532d"; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 46px 'Bricolage Grotesque', system-ui, sans-serif";
  ctx.fillText(aj("negocio", "Mi tienda"), W / 2, 72);
  ctx.font = "500 26px system-ui, sans-serif"; ctx.fillStyle = "#cfe5d6";
  ctx.fillText(aj("tel", "") ? "WhatsApp " + telBonito(aj("tel", "")) : "Gracias por tu compra", W / 2, 116);
  ctx.fillStyle = "#1c2420"; ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText(`Ticket ${v.folio} · ${fechaHora(v.fecha)}`, W / 2, 200);
  let y = 260; ctx.textAlign = "left";
  ctx.strokeStyle = "#1c2420"; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(40, 225); ctx.lineTo(W - 40, 225); ctx.stroke();
  for (const f of filas) {
    ctx.fillStyle = "#1c2420"; ctx.font = "500 30px system-ui, sans-serif";
    f.ls.forEach((l, i) => ctx.fillText(l, 40, y + i * 38));
    ctx.fillStyle = "#5b6b62"; ctx.font = "400 24px system-ui, sans-serif"; ctx.fillText(`${f.cant} × ${dinero(f.precio)}`, 40, y + f.ls.length * 38 - 4);
    ctx.textAlign = "right"; ctx.fillStyle = "#1c2420"; ctx.font = "700 30px system-ui, sans-serif"; ctx.fillText(dinero(f.precio * f.cant), W - 40, y); ctx.textAlign = "left";
    y += f.ls.length * 38 + 24;
  }
  ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke(); ctx.setLineDash([]);
  y += 60; ctx.font = "800 44px 'Bricolage Grotesque', system-ui, sans-serif"; ctx.fillText("TOTAL", 40, y); ctx.textAlign = "right"; ctx.fillText(dinero(v.total), W - 40, y);
  ctx.font = "500 28px system-ui, sans-serif"; ctx.textAlign = "left"; y += 50;
  ctx.fillText(`Pago: ${PAGOS[v.pago].replace(/^\S+\s/, "")}`, 40, y);
  if (v.pago === "efectivo") { ctx.textAlign = "right"; ctx.fillText(`Recibido ${dinero(v.recibido)} · Cambio ${dinero(v.cambio)}`, W - 40, y); }
  if (v.clienteId && cliente(v.clienteId)) { y += 44; ctx.textAlign = "left"; ctx.fillStyle = "#b42318"; ctx.fillText(`Cuenta de ${cliente(v.clienteId).nombre}: ${dinero(saldo(v.clienteId))}`, 40, y); }
  ctx.textAlign = "center"; ctx.fillStyle = "#14532d"; ctx.font = "700 28px system-ui, sans-serif"; ctx.fillText("¡Gracias por tu compra!", W / 2, H - 50);
  return cv;
}

// =====================================================================
// PRODUCTOS
// =====================================================================
function pintarProductos() {
  const v = $("vista");
  const q = normal(filtroProd);
  const nBajos = S.productos.filter(bajoStock).length;
  let lista = S.productos.filter((p) => !q || normal(p.nombre).includes(q) || String(p.codigo || "").includes(filtroProd.trim()));
  if (filtroLista === "bajos") lista = lista.filter(bajoStock);
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const valor = r2(S.productos.reduce((s, p) => s + (p.stock > 0 && p.costo ? p.stock * p.costo : 0), 0));
  v.innerHTML = `<h2>Productos</h2>
    <div class="fila" style="margin-bottom:12px"><button class="btn prim" id="nuevoProd">➕ Agregar</button><button class="btn" id="escProd">📷 Escanear</button></div>
    ${nBajos ? `<div class="alerta">📦 ${nBajos} ${nBajos === 1 ? "producto se está" : "productos se están"} acabando.</div>` : ""}
    <div class="chips"><button class="chip" data-f="todos" aria-pressed="${filtroLista === "todos"}">Todos (${S.productos.length})</button><button class="chip" data-f="bajos" aria-pressed="${filtroLista === "bajos"}">Por acabarse (${nBajos})</button></div>
    <input id="buscarP" type="search" placeholder="Buscar" value="${esc(filtroProd)}" aria-label="Buscar producto" style="margin-bottom:10px">
    ${lista.map((p) => `<button class="item" data-pid="${p.id}"><span class="t"><b>${esc(p.nombre)}</b><small>${p.categoria ? esc(p.categoria) + " · " : ""}${p.stock !== null && p.stock !== "" && p.stock !== undefined ? `<span style="${bajoStock(p) ? "color:var(--rojo);font-weight:700" : ""}">Quedan ${Number(p.stock)}</span>` : "Sin control de inventario"}${p.codigo ? " · 🏷️" : ""}</small></span><span class="d num">${dineroCorto(p.precio)}</span></button>`).join("") || `<p class="ayuda">No hay productos aquí.</p>`}
    ${valor ? `<p class="ayuda" style="margin-top:10px">Tu inventario vale ${dinero(valor)} a precio de costo.</p>` : ""}`;
  $("nuevoProd").onclick = () => formProducto();
  $("escProd").onclick = () => Escaner.abrir((c) => { const p = S.productos.find((x) => x.codigo === c); if (p) formProducto(p); else formProducto(null, { codigo: c }); return ""; }, false);
  v.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { filtroLista = b.dataset.f; pintarProductos(); });
  v.querySelectorAll("[data-pid]").forEach((b) => b.onclick = () => formProducto(producto(b.dataset.pid)));
  const bp = $("buscarP"); bp.oninput = () => { filtroProd = bp.value; const pos = bp.selectionStart; pintarProductos(); const n = $("buscarP"); n.focus(); n.setSelectionRange(pos, pos); };
}
function formProducto(p, base = {}) {
  const e = p || { nombre: "", precio: "", costo: "", stock: "", minimo: "", codigo: "", categoria: "", ...base };
  const cats = [...new Set(S.productos.map((x) => x.categoria).filter(Boolean))];
  abrirModal(p ? "Editar producto" : "Nuevo producto", `
    <label class="campo"><span>Nombre</span><input id="fNom" value="${esc(e.nombre)}" placeholder="Ej. Coca 600 ml"></label>
    <div class="fila"><label class="campo"><span>Precio de venta</span><input id="fPre" inputmode="decimal" value="${esc(e.precio)}" placeholder="0.00"></label>
    <label class="campo"><span>Te cuesta (opcional)</span><input id="fCos" inputmode="decimal" value="${esc(e.costo ?? "")}" placeholder="Para saber tu ganancia"></label></div>
    <div class="fila"><label class="campo"><span>Cuántos tienes</span><input id="fSto" inputmode="decimal" value="${esc(e.stock ?? "")}" placeholder="Vacío = no contar"></label>
    <label class="campo"><span>Avísame cuando queden</span><input id="fMin" inputmode="decimal" value="${esc(e.minimo ?? "")}" placeholder="Ej. 3"></label></div>
    <div class="fila"><label class="campo"><span>Código de barras</span><input id="fCod" value="${esc(e.codigo || "")}" inputmode="numeric" placeholder="Escanéalo →"></label><button class="btn icono" id="fEsc" style="margin-bottom:10px" aria-label="Escanear código">📷</button></div>
    <label class="campo"><span>Categoría (opcional)</span><input id="fCat" list="listaCats" value="${esc(e.categoria || "")}" placeholder="Ej. Refrescos"><datalist id="listaCats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <p class="ayuda" id="fGan"></p>
    <button class="btn prim ancho" id="fOk">${p ? "Guardar cambios" : "Agregar producto"}</button>
    ${p ? `<button class="btn ancho" id="fEntrada" style="margin-top:8px">🚚 Llegó mercancía (sumar al inventario)</button>
    <button class="btn peligro ancho" id="fBorrar" style="margin-top:8px">Borrar producto</button>` : ""}`, () => {
    const gan = () => { const pr = r2($("fPre").value), co = r2($("fCos").value); $("fGan").textContent = pr && co ? `Ganas ${dinero(pr - co)} por pieza (${Math.round((pr - co) / pr * 100)}%).` : ""; };
    $("fPre").oninput = gan; $("fCos").oninput = gan; gan();
    if (!e.nombre) $("fNom").focus();
    $("fEsc").onclick = () => Escaner.abrir((c) => { $("fCod").value = c; return ""; }, false);
    $("fOk").onclick = async () => {
      const nombre = $("fNom").value.trim(), precio = r2(String($("fPre").value).replace(",", "."));
      if (!nombre) { avisar("Escribe el nombre"); return; }
      if (!(precio >= 0) || $("fPre").value === "") { avisar("Escribe el precio"); return; }
      const codigo = $("fCod").value.trim();
      const otro = codigo && S.productos.find((x) => x.codigo === codigo && (!p || x.id !== p.id));
      if (otro) { avisar(`Ese código ya es de "${otro.nombre}"`, 3500); return; }
      const num = (id) => { const t = String($(id).value).trim().replace(",", "."); return t === "" ? null : r2(t); };
      const obj = { ...(p || { id: nuevoId(), creado: ahora(), vendidos: 0 }), nombre, precio, costo: num("fCos"), stock: num("fSto"), minimo: num("fMin"), codigo, categoria: $("fCat").value.trim(), act: ahora() };
      await DB.guardar("productos", obj);
      const k = S.productos.findIndex((x) => x.id === obj.id); if (k >= 0) S.productos[k] = obj; else S.productos.push(obj);
      cerrarModal(); avisar(p ? "Producto guardado" : "Producto agregado"); pintar();
    };
    if (p) {
      $("fEntrada").onclick = async () => {
        const n = prompt(`¿Cuántas piezas de ${p.nombre} llegaron?`); if (!n) return;
        const cant = r2(String(n).replace(",", ".")); if (!(cant > 0)) return;
        const costo = prompt("¿Cuánto te costó cada una? (déjalo igual si no cambió)", p.costo ?? "");
        const obj = { ...p, stock: r2((Number(p.stock) || 0) + cant), act: ahora() };
        if (costo !== null && costo !== "") obj.costo = r2(String(costo).replace(",", "."));
        await DB.guardar("productos", obj); S.productos[S.productos.findIndex((x) => x.id === p.id)] = obj;
        cerrarModal(); avisar(`Listo: ahora tienes ${obj.stock} de ${p.nombre}`); pintar();
      };
      $("fBorrar").onclick = async () => {
        if (!confirm(`¿Borrar "${p.nombre}"? Las ventas pasadas no se borran.`)) return;
        await DB.borrar("productos", p.id); S.productos = S.productos.filter((x) => x.id !== p.id);
        carrito = carrito.filter((c) => c.pid !== p.id); guardarCarrito(); cerrarModal(); avisar("Producto borrado"); pintar();
      };
    }
  });
}

// =====================================================================
// FIADO (el cuaderno)
// =====================================================================
function diasSin(cid) { const m = ultimoMov(cid); return m ? Math.floor((Date.now() - new Date(m.fecha)) / 86400000) : null; }
function pintarFiado() {
  const v = $("vista");
  const q = normal(filtroProd);
  const conSaldo = S.clientes.map((c) => ({ c, s: saldo(c.id) })).filter((x) => !q || normal(x.c.nombre).includes(q)).sort((a, b) => b.s - a.s || a.c.nombre.localeCompare(b.c.nombre));
  const totalDeben = r2(S.clientes.reduce((s, c) => s + Math.max(0, saldo(c.id)), 0));
  const deudores = S.clientes.filter((c) => saldo(c.id) > 0).length;
  v.innerHTML = `<h2>Fiado</h2>
    <div class="cifras"><div class="cifra grande"><small>Te deben en total</small><b class="num">${dinero(totalDeben)}</b></div>
      <div class="cifra"><small>Clientes que deben</small><b>${deudores}</b></div>
      <div class="cifra"><small>Cobrado este mes</small><b class="num">${dinero(abonosDesde(inicioMes()))}</b></div></div>
    <div class="fila" style="margin-bottom:12px"><button class="btn prim" id="nuevoCli">➕ Cliente</button><input id="buscarC" type="search" placeholder="Buscar cliente" value="${esc(filtroProd)}" aria-label="Buscar cliente"></div>
    <div class="cuaderno">
      <div class="hoja-tit">Cuaderno de cuentas</div>
      ${conSaldo.length ? conSaldo.map(({ c, s }) => { const d = diasSin(c.id); return `<button class="cuenta" data-cli="${c.id}"><span class="quien">${esc(c.nombre)}<small>${d === null ? "sin movimientos" : d === 0 ? "hoy" : `hace ${d} ${d === 1 ? "día" : "días"}`}</small></span><span class="debe num ${s <= 0 ? "cero" : ""}">${s <= 0 ? (s < 0 ? "A favor " + dineroCorto(-s) : "Al corriente") : dinero(s)}</span></button>`; }).join("")
        : `<div class="vacio">Aquí se apuntan los clientes a los que les fías. Agrega uno o cobra una venta con "Fiado".</div>`}
    </div>`;
  $("nuevoCli").onclick = () => formCliente();
  v.querySelectorAll("[data-cli]").forEach((b) => b.onclick = () => verCliente(b.dataset.cli));
  const bc = $("buscarC"); bc.oninput = () => { filtroProd = bc.value; const pos = bc.selectionStart; pintarFiado(); const n = $("buscarC"); n.focus(); n.setSelectionRange(pos, pos); };
}
const inicioMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };
const abonosDesde = (iso) => r2(S.movimientos.filter((m) => m.tipo === "abono" && m.fecha >= iso).reduce((s, m) => s + m.monto, 0));
function formCliente(c) {
  const e = c || { nombre: "", tel: "", limite: null, nota: "" };
  abrirModal(c ? "Editar cliente" : "Cliente nuevo", `
    <label class="campo"><span>Nombre</span><input id="cNom" value="${esc(e.nombre)}" placeholder="Ej. Doña Mari"></label>
    <label class="campo"><span>WhatsApp (10 dígitos)</span><input id="cTel" inputmode="numeric" value="${esc(e.tel)}" placeholder="Para mandarle su cuenta"></label>
    <label class="campo"><span>Límite de fiado (opcional)</span><input id="cLim" inputmode="decimal" value="${esc(e.limite ?? "")}" placeholder="Ej. 500"></label>
    <label class="campo"><span>Nota (opcional)</span><input id="cNot" value="${esc(e.nota || "")}" placeholder="Ej. Paga los viernes"></label>
    <button class="btn prim ancho" id="cOk">${c ? "Guardar" : "Agregar cliente"}</button>
    ${c ? `<button class="btn peligro ancho" id="cBorrar" style="margin-top:8px">Borrar cliente</button>` : ""}`, () => {
    if (!c) $("cNom").focus();
    $("cOk").onclick = async () => {
      const nombre = $("cNom").value.trim(); if (!nombre) { avisar("Escribe el nombre"); return; }
      const lim = String($("cLim").value).trim();
      const obj = { ...(c || { id: nuevoId(), creado: ahora() }), nombre, tel: $("cTel").value.replace(/\D/g, ""), limite: lim === "" ? null : r2(lim.replace(",", ".")), nota: $("cNot").value.trim() };
      await DB.guardar("clientes", obj);
      const k = S.clientes.findIndex((x) => x.id === obj.id); if (k >= 0) S.clientes[k] = obj; else S.clientes.push(obj);
      avisar("Cliente guardado"); if (c) verCliente(c.id); else { cerrarModal(); pintar(); }
    };
    if (c) $("cBorrar").onclick = async () => {
      if (saldo(c.id) > 0) { avisar(`${c.nombre} todavía debe ${dinero(saldo(c.id))}. Primero salda su cuenta.`, 3500); return; }
      if (!confirm(`¿Borrar a ${c.nombre} y sus movimientos?`)) return;
      const movs = S.movimientos.filter((m) => m.clienteId === c.id);
      await DB.lote([["clientes", "borrar", c.id], ...movs.map((m) => ["movimientos", "borrar", m.id])]);
      S.clientes = S.clientes.filter((x) => x.id !== c.id); S.movimientos = S.movimientos.filter((m) => m.clienteId !== c.id);
      cerrarModal(); avisar("Cliente borrado"); pintar();
    };
  });
}
function verCliente(cid) {
  const c = cliente(cid); if (!c) return;
  const s = saldo(cid), movs = S.movimientos.filter((m) => m.clienteId === cid).slice(-40).reverse();
  const pct = c.limite ? Math.min(100, Math.round(Math.max(0, s) / c.limite * 100)) : 0;
  abrirModal(c.nombre, `
    <div class="saldo-grande"><small>${s > 0 ? "Debe" : s < 0 ? "Tiene a favor" : "Está al corriente"}</small><b class="num ${s <= 0 ? "cero" : ""}">${dinero(Math.abs(s))}</b>
      ${c.limite ? `<div class="barra-limite" role="img" aria-label="Usa ${pct}% de su límite"><i class="${pct >= 100 ? "lleno" : ""}" style="width:${pct}%"></i></div><small>Límite ${dinero(c.limite)} · le quedan ${dinero(Math.max(0, c.limite - s))}</small>` : ""}
      ${c.nota ? `<small style="display:block;margin-top:4px">📝 ${esc(c.nota)}</small>` : ""}</div>
    <div class="fila" style="margin-bottom:8px"><button class="btn prim" id="abonar">💵 Abonar</button><button class="btn" id="cargoManual">➕ Apuntar</button></div>
    <div class="fila" style="margin-bottom:14px"><button class="btn" id="recordar" ${c.tel ? "" : "disabled"}>📲 Cobrar por WhatsApp</button><button class="btn" id="estado">📄 Estado de cuenta</button></div>
    ${!c.tel ? `<p class="ayuda" style="margin:-6px 0 12px">Agrega su WhatsApp en ✏️ Editar para mandarle su cuenta.</p>` : ""}
    <div class="cuaderno">
      <div class="hoja-tit">Movimientos</div>
      ${movs.length ? movs.map((m) => `<div class="mov"><span class="f">${fechaCorta(m.fecha)}</span><span class="c">${esc(m.concepto || (m.tipo === "abono" ? "Abono" : "Fiado"))}</span><span class="m num ${m.tipo}">${m.tipo === "abono" ? "−" : "+"}${dineroCorto(m.monto)}</span></div>`).join("") : `<div class="vacio">Todavía no tiene movimientos.</div>`}
    </div>
    <button class="btn ancho" id="editarCli" style="margin-top:12px">✏️ Editar datos</button>`, () => {
    $("abonar").onclick = () => abono(c);
    $("cargoManual").onclick = () => cargoManual(c);
    $("recordar").onclick = () => abrirWhatsApp(c.tel, mensajeCobro(c));
    $("estado").onclick = () => compartirImagen(dibujarEstado(c), `cuenta-${normal(c.nombre).replace(/\W+/g, "-")}.jpg`, `Estado de cuenta de ${c.nombre}`);
    $("editarCli").onclick = () => formCliente(c);
  });
}
function mensajeCobro(c) {
  const s = saldo(c.id), neg = aj("negocio", "la tienda");
  const ult = S.movimientos.filter((m) => m.clienteId === c.id && m.tipo === "cargo").slice(-3).map((m) => `• ${fechaCorta(m.fecha)}: ${m.concepto || "compra"} (${dineroCorto(m.monto)})`).join("\n");
  return `Hola ${c.nombre} 👋, te saluda ${neg}.\nTu cuenta va en *${dinero(s)}*.${ult ? `\n\nÚltimas compras:\n${ult}` : ""}\n\n¿Cuándo puedes pasar a abonar? ¡Gracias! 🙏`;
}
function abono(c) {
  const s = saldo(c.id);
  abrirModal(`Abono de ${c.nombre}`, `
    <div class="saldo-grande"><small>Debe</small><b class="num">${dinero(s)}</b></div>
    <label class="campo"><span>¿Cuánto abona?</span><input id="aMon" inputmode="decimal" placeholder="0.00"></label>
    <div class="billetes"><button data-a="${s}">Todo (${dineroCorto(s)})</button>${[50, 100, 200].filter((x) => x < s).map((x) => `<button data-a="${x}">${dineroCorto(x)}</button>`).join("")}</div>
    <div class="pagos" role="group" aria-label="Cómo paga"><button class="pago" data-ap="efectivo" aria-pressed="true">💵 Efectivo</button><button class="pago" data-ap="transferencia" aria-pressed="false">🏦 Transferencia</button></div>
    <button class="btn prim ancho" id="aOk">Registrar abono</button>`, (m) => {
    let forma = "efectivo";
    $("aMon").focus();
    m.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => { $("aMon").value = b.dataset.a; });
    m.querySelectorAll("[data-ap]").forEach((b) => b.onclick = () => { forma = b.dataset.ap; m.querySelectorAll("[data-ap]").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
    $("aOk").onclick = async () => {
      const monto = r2(String($("aMon").value).replace(",", ".")); if (!(monto > 0)) { avisar("Escribe cuánto abona"); return; }
      if (monto > s && !confirm(`El abono es mayor a lo que debe. Quedará ${dinero(monto - s)} a su favor. ¿Seguir?`)) return;
      const mov = { id: nuevoId(), clienteId: c.id, fecha: ahora(), tipo: "abono", monto, forma, concepto: `Abono (${forma})` };
      await DB.guardar("movimientos", mov); S.movimientos.push(mov);
      avisar(`Abono registrado. Ahora debe ${dinero(saldo(c.id))}`, 3000);
      verCliente(c.id); pintarFiado();
    };
  });
}
function cargoManual(c) {
  abrirModal(`Apuntar a ${c.nombre}`, `<p class="ayuda" style="margin-bottom:10px">Para deudas que vienen de antes o cosas que no pasaron por la caja.</p>
    <label class="campo"><span>¿Qué se llevó?</span><input id="mCon" placeholder="Ej. Cuenta anterior del cuaderno"></label>
    <label class="campo"><span>Monto</span><input id="mMon" inputmode="decimal" placeholder="0.00"></label>
    <button class="btn prim ancho" id="mOk">Apuntar</button>`, () => {
    $("mCon").focus();
    $("mOk").onclick = async () => {
      const monto = r2(String($("mMon").value).replace(",", ".")); if (!(monto > 0)) { avisar("Escribe el monto"); return; }
      const mov = { id: nuevoId(), clienteId: c.id, fecha: ahora(), tipo: "cargo", monto, concepto: $("mCon").value.trim() || "Apunte manual" };
      await DB.guardar("movimientos", mov); S.movimientos.push(mov); avisar("Apuntado"); verCliente(c.id); pintarFiado();
    };
  });
}
function dibujarEstado(c) {
  const movs = S.movimientos.filter((m) => m.clienteId === c.id).slice(-15);
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d"), W = 720, H = 430 + movs.length * 52 + 150;
  cv.width = W; cv.height = H;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  // renglones de cuaderno
  ctx.fillStyle = "#c9d8ee"; for (let y = 300; y < H - 120; y += 52) ctx.fillRect(0, y + 14, W, 2);
  ctx.fillStyle = "#e8a0a0"; ctx.fillRect(70, 260, 3, H - 380);
  ctx.fillStyle = "#14532d"; ctx.fillRect(0, 0, W, 130);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 42px 'Bricolage Grotesque', system-ui, sans-serif"; ctx.fillText(aj("negocio", "Mi tienda"), W / 2, 66);
  ctx.font = "500 26px system-ui, sans-serif"; ctx.fillStyle = "#cfe5d6"; ctx.fillText("Estado de cuenta", W / 2, 106);
  ctx.fillStyle = "#1c2420"; ctx.font = "700 34px system-ui, sans-serif"; ctx.fillText(c.nombre, W / 2, 180);
  const s = saldo(c.id); ctx.fillStyle = s > 0 ? "#b42318" : "#14532d"; ctx.font = "800 52px 'Bricolage Grotesque', system-ui, sans-serif";
  ctx.fillText(s > 0 ? `Debe ${dinero(s)}` : s < 0 ? `A favor ${dinero(-s)}` : "Al corriente ✓", W / 2, 245);
  let y = 300; ctx.textAlign = "left";
  for (const m of movs) {
    ctx.fillStyle = "#5b6b62"; ctx.font = "500 24px system-ui, sans-serif"; ctx.fillText(fechaCorta(m.fecha), 86, y);
    ctx.fillStyle = "#1c2420"; ctx.font = "500 26px system-ui, sans-serif"; ctx.fillText(lineas(ctx, m.concepto || (m.tipo === "abono" ? "Abono" : "Compra"), 380, 1)[0] || "", 190, y);
    ctx.textAlign = "right"; ctx.fillStyle = m.tipo === "abono" ? "#14532d" : "#b42318"; ctx.font = "700 28px system-ui, sans-serif";
    ctx.fillText((m.tipo === "abono" ? "−" : "+") + dinero(m.monto), W - 30, y); ctx.textAlign = "left"; y += 52;
  }
  ctx.textAlign = "center"; ctx.fillStyle = "#5b6b62"; ctx.font = "500 24px system-ui, sans-serif";
  ctx.fillText(`Al ${new Date().toLocaleDateString("es-MX", { dateStyle: "long" })}`, W / 2, H - 70);
  ctx.fillStyle = "#14532d"; ctx.font = "700 26px system-ui, sans-serif"; ctx.fillText("¡Gracias por tu preferencia!", W / 2, H - 30);
  return cv;
}

// =====================================================================
// CORTE DE CAJA
// =====================================================================
function resumenDesde(desde) {
  const vs = S.ventas.filter((v) => v.fecha > desde);
  const por = { efectivo: 0, transferencia: 0, tarjeta: 0, fiado: 0 };
  let ganancia = 0, sinCosto = 0;
  for (const v of vs) { por[v.pago] = r2((por[v.pago] || 0) + v.total); for (const i of v.items) { if (i.costo == null) sinCosto += i.precio * i.cant; else ganancia += (i.precio - i.costo) * i.cant; } }
  const movs = S.movimientos.filter((m) => m.fecha > desde);
  const abonosEf = r2(movs.filter((m) => m.tipo === "abono" && (m.forma || "efectivo") === "efectivo").reduce((s, m) => s + m.monto, 0));
  const abonosOtros = r2(movs.filter((m) => m.tipo === "abono" && m.forma && m.forma !== "efectivo").reduce((s, m) => s + m.monto, 0));
  const salidas = movs.filter((m) => m.tipo === "salida");
  const totalSalidas = r2(salidas.reduce((s, m) => s + m.monto, 0));
  return { vs, por, total: r2(vs.reduce((s, v) => s + v.total, 0)), ganancia: r2(ganancia), sinCosto: r2(sinCosto), abonosEf, abonosOtros, salidas, totalSalidas };
}
function pintarCorte() {
  const v = $("vista");
  const ult = S.cortes[S.cortes.length - 1];
  const desde = ult ? ult.fecha : "0000";
  const fondo = r2(aj("fondo", 0));
  const R = resumenDesde(desde);
  const esperado = r2(fondo + R.por.efectivo + R.abonosEf - R.totalSalidas);
  v.innerHTML = `<h2>Corte de caja</h2>
    <p class="ayuda" style="margin-bottom:12px">${ult ? `Desde el último corte: ${fechaHora(ult.fecha)}.` : "Desde que empezaste a usar la caja."} ${R.vs.length} ${R.vs.length === 1 ? "venta" : "ventas"}.</p>
    <div class="cifras">
      <div class="cifra grande"><small>Debe haber en efectivo</small><b class="num">${dinero(esperado)}</b></div>
      <div class="cifra"><small>Vendido</small><b class="num">${dinero(R.total)}</b></div>
      <div class="cifra"><small>Ganancia estimada</small><b class="num">${dinero(R.ganancia)}</b></div>
    </div>
    <table class="tabla"><tbody>
      <tr><td>Fondo inicial de caja</td><td class="num">${dinero(fondo)}</td></tr>
      <tr><td>💵 Ventas en efectivo</td><td class="num">${dinero(R.por.efectivo)}</td></tr>
      <tr><td>📒 Abonos de fiado en efectivo</td><td class="num">${dinero(R.abonosEf)}</td></tr>
      <tr><td>📤 Salidas y gastos</td><td class="num">−${dinero(R.totalSalidas)}</td></tr>
      <tr><td>🏦 Transferencias</td><td class="num">${dinero(R.por.transferencia + R.abonosOtros)}</td></tr>
      <tr><td>💳 Tarjeta</td><td class="num">${dinero(R.por.tarjeta)}</td></tr>
      <tr><td>📒 Se fió</td><td class="num">${dinero(R.por.fiado)}</td></tr>
    </tbody></table>
    ${R.sinCosto ? `<p class="ayuda" style="margin:-4px 0 12px">La ganancia no incluye ${dinero(R.sinCosto)} vendidos de productos sin costo registrado.</p>` : ""}
    <div class="fila" style="margin-bottom:14px"><button class="btn" id="salida">📤 Registrar salida o gasto</button><button class="btn" id="fondo">💼 Fondo: ${dineroCorto(fondo)}</button></div>
    <label class="campo"><span>¿Cuánto efectivo contaste en la caja?</span><input id="contado" inputmode="decimal" placeholder="${esperado.toFixed(2)}"></label>
    <p id="dif" class="ayuda" style="margin:-4px 0 10px"></p>
    <button class="btn cobrar ancho" id="hacerCorte">Hacer corte</button>
    ${S.cortes.length ? `<div class="seccion">Cortes anteriores</div>${S.cortes.slice(-8).reverse().map((c) => `<div class="item" style="cursor:default"><span class="t"><b>${fechaHora(c.fecha)}</b><small>Vendido ${dinero(c.total)} · ${c.ventas} ventas</small></span><span class="d num ${c.diferencia < 0 ? "dif-mal" : "dif-ok"}">${c.diferencia === 0 ? "Cuadró" : (c.diferencia > 0 ? "+" : "") + dineroCorto(c.diferencia)}</span></div>`).join("")}` : ""}`;
  $("contado").oninput = () => {
    const t = $("contado").value.trim(); if (!t) { $("dif").textContent = ""; return; }
    const d = r2(r2(t.replace(",", ".")) - esperado);
    $("dif").innerHTML = d === 0 ? `<span class="dif-ok">✅ La caja cuadra exacto.</span>` : d > 0 ? `<span class="dif-ok">Sobran ${dinero(d)}.</span>` : `<span class="dif-mal">Faltan ${dinero(-d)}.</span>`;
  };
  $("fondo").onclick = async () => { const n = prompt("¿Con cuánto efectivo empiezas la caja (fondo para dar cambio)?", fondo); if (n === null) return; await ponerAjuste("fondo", r2(String(n).replace(",", "."))); pintarCorte(); };
  $("salida").onclick = () => abrirModal("Salida de dinero", `<p class="ayuda" style="margin-bottom:10px">Dinero que sacas de la caja: pago a proveedor, gastos, retiro.</p>
      <label class="campo"><span>¿Para qué?</span><input id="sCon" placeholder="Ej. Pago a proveedor de refrescos"></label>
      <label class="campo"><span>Monto</span><input id="sMon" inputmode="decimal" placeholder="0.00"></label>
      <button class="btn prim ancho" id="sOk">Registrar salida</button>`, () => {
    $("sCon").focus();
    $("sOk").onclick = async () => {
      const monto = r2(String($("sMon").value).replace(",", ".")); if (!(monto > 0)) { avisar("Escribe el monto"); return; }
      const mov = { id: nuevoId(), clienteId: null, fecha: ahora(), tipo: "salida", monto, concepto: $("sCon").value.trim() || "Salida" };
      await DB.guardar("movimientos", mov); S.movimientos.push(mov); cerrarModal(); avisar("Salida registrada"); pintarCorte();
    };
  });
  $("hacerCorte").onclick = async () => {
    const t = $("contado").value.trim();
    if (!t) { avisar("Escribe cuánto efectivo contaste"); $("contado").focus(); return; }
    const contado = r2(t.replace(",", "."));
    const corte = { id: nuevoId(), fecha: ahora(), desde, fondo, esperado, contado, diferencia: r2(contado - esperado), total: R.total, ventas: R.vs.length, por: R.por, abonosEf: R.abonosEf, salidas: R.totalSalidas, ganancia: R.ganancia };
    await DB.guardar("cortes", corte); S.cortes.push(corte);
    const texto = `💰 *Corte de caja* · ${aj("negocio", "")}\n${fechaHora(corte.fecha)}\n\nVentas: ${corte.ventas} · ${dinero(corte.total)}\nEfectivo: ${dinero(R.por.efectivo)}\nTransferencia: ${dinero(R.por.transferencia)}\nTarjeta: ${dinero(R.por.tarjeta)}\nFiado: ${dinero(R.por.fiado)}\nAbonos en efectivo: ${dinero(R.abonosEf)}\nSalidas: ${dinero(R.totalSalidas)}\n\nDebía haber: ${dinero(esperado)}\nSe contó: ${dinero(contado)}\n${corte.diferencia === 0 ? "✅ Cuadró" : corte.diferencia > 0 ? `Sobraron ${dinero(corte.diferencia)}` : `⚠️ Faltaron ${dinero(-corte.diferencia)}`}\nGanancia estimada: ${dinero(R.ganancia)}`;
    abrirModal("Corte hecho", `<div class="saldo-grande"><small>${corte.diferencia === 0 ? "La caja cuadró" : corte.diferencia > 0 ? "Sobraron" : "Faltaron"}</small><b class="num ${corte.diferencia < 0 ? "" : "cero"}">${dinero(Math.abs(corte.diferencia))}</b></div>
      <button class="btn prim ancho" id="corteWa">📲 Mandar resumen por WhatsApp</button><button class="btn ancho" id="corteOk" style="margin-top:8px">Listo</button>`, () => {
      $("corteWa").onclick = () => abrirWhatsApp(aj("tel", ""), texto);
      $("corteOk").onclick = () => { cerrarModal(); pintarCorte(); };
    });
  };
}

// =====================================================================
// REPORTES Y AJUSTES
// =====================================================================
function pintarReportes() {
  const v = $("vista");
  const desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - (periodo - 1));
  const vs = S.ventas.filter((x) => new Date(x.fecha) >= desde);
  const total = r2(vs.reduce((s, x) => s + x.total, 0));
  let ganancia = 0; const prods = {};
  for (const x of vs) for (const i of x.items) { if (i.costo != null) ganancia += (i.precio - i.costo) * i.cant; const k = i.nombre; prods[k] ??= { cant: 0, total: 0 }; prods[k].cant += i.cant; prods[k].total += i.precio * i.cant; }
  const top = Object.entries(prods).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  const horas = Array(24).fill(0); for (const x of vs) horas[new Date(x.fecha).getHours()] += x.total;
  const hMax = Math.max(...horas), mejorHora = hMax > 0 ? horas.indexOf(hMax) : null;
  const bajosL = S.productos.filter(bajoStock);
  const ultRespaldo = aj("respaldo", null);
  const diasResp = ultRespaldo ? Math.floor((Date.now() - new Date(ultRespaldo)) / 86400000) : null;
  v.innerHTML = `<h2>Reportes</h2>
    <div class="chips" role="group" aria-label="Periodo">${[[1, "Hoy"], [7, "7 días"], [30, "30 días"]].map(([d, t]) => `<button class="chip" data-per="${d}" aria-pressed="${periodo === d}">${t}</button>`).join("")}</div>
    <div class="cifras">
      <div class="cifra grande"><small>Vendido</small><b class="num">${dinero(total)}</b></div>
      <div class="cifra"><small>Ganancia estimada</small><b class="num">${dinero(ganancia)}</b></div>
      <div class="cifra"><small>Ventas · promedio</small><b class="num">${vs.length} · ${vs.length ? dineroCorto(total / vs.length) : "$0"}</b></div>
    </div>
    ${periodo > 1 ? `<canvas class="grafica" id="grafica" role="img" aria-label="Ventas por día"></canvas>` : ""}
    ${mejorHora !== null ? `<p class="ayuda" style="margin-bottom:12px">⏰ Tu hora más fuerte: de ${mejorHora}:00 a ${mejorHora + 1}:00.</p>` : ""}
    <div class="seccion">Lo que más vendes</div>
    ${top.length ? `<table class="tabla"><tbody>${top.map(([n, d]) => `<tr><td>${esc(n)} <small style="color:var(--gris)">× ${r2(d.cant)}</small></td><td class="num">${dinero(d.total)}</td></tr>`).join("")}</tbody></table>` : `<p class="ayuda">Todavía no hay ventas en este periodo.</p>`}
    ${bajosL.length ? `<div class="seccion">Por acabarse</div><div class="alerta">${bajosL.map((p) => `${esc(p.nombre)} (${Number(p.stock)})`).join(", ")}</div>` : ""}
    <div class="seccion">Tu negocio</div>
    <label class="campo"><span>Nombre de la tienda (sale en tickets)</span><input id="ajNeg" value="${esc(aj("negocio", ""))}" placeholder="Ej. Abarrotes Lupita"></label>
    <label class="campo"><span>Tu WhatsApp (para recibir tus cortes)</span><input id="ajTel" inputmode="numeric" value="${esc(aj("tel", ""))}" placeholder="10 dígitos"></label>
    <div class="seccion">Respaldo de tus datos</div>
    <div class="alerta ${diasResp === null || diasResp > 7 ? "roja" : ""}">${diasResp === null ? "Nunca has respaldado. Si se pierde o se borra el teléfono, se pierde todo." : diasResp === 0 ? "Respaldaste hoy. 👍" : `Último respaldo hace ${diasResp} ${diasResp === 1 ? "día" : "días"}.`} Guárdalo en tu WhatsApp o en Drive.</div>
    <div class="fila" style="margin-bottom:8px"><button class="btn prim" id="respaldar">💾 Respaldar</button><button class="btn" id="restaurar">📥 Restaurar</button></div>
    <input type="file" id="archivoResp" accept="application/json,.json" hidden>
    <button class="btn ancho" id="instalar" hidden style="margin-top:8px">📲 Instalar en mi pantalla</button>
    <button class="btn peligro ancho" id="borrarTodo" style="margin-top:20px">Borrar todos los datos</button>
    <p class="ayuda" style="margin-top:16px;text-align:center">Caja Guizar · hecha por Ediciones Guizar · tus datos solo viven en este teléfono</p>`;
  v.querySelectorAll("[data-per]").forEach((b) => b.onclick = () => { periodo = Number(b.dataset.per); pintarReportes(); });
  if (periodo > 1) grafica($("grafica"), desde);
  $("ajNeg").onchange = async () => { await ponerAjuste("negocio", $("ajNeg").value.trim()); pintar(); avisar("Guardado"); };
  $("ajTel").onchange = async () => { await ponerAjuste("tel", $("ajTel").value.replace(/\D/g, "")); avisar("Guardado"); };
  $("respaldar").onclick = respaldar;
  $("restaurar").onclick = () => $("archivoResp").click();
  $("archivoResp").onchange = restaurar;
  if (pedirInstalar) { $("instalar").hidden = false; $("instalar").onclick = async () => { pedirInstalar.prompt(); await pedirInstalar.userChoice; pedirInstalar = null; $("instalar").hidden = true; }; }
  $("borrarTodo").onclick = async () => {
    if (!confirm("Se borrarán productos, ventas, fiado y cortes de este teléfono. ¿Seguro?")) return;
    if (prompt('Para confirmar escribe BORRAR') !== "BORRAR") return;
    for (const t of DB.TABLAS) await DB.vaciar(t);
    await cargarTodo(); carrito = []; guardarCarrito(); avisar("Datos borrados"); irA("vender");
  };
}
function grafica(cv, desde) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const dias = [];
  for (let d = new Date(desde); d <= new Date(); d.setDate(d.getDate() + 1)) dias.push(d.toLocaleDateString("en-CA"));
  const suma = Object.fromEntries(dias.map((d) => [d, 0]));
  for (const v of S.ventas) { const k = diaDe(v.fecha); if (k in suma) suma[k] += v.total; }
  const vals = dias.map((d) => suma[d]), max = Math.max(1, ...vals);
  const izq = 12, abajo = 26, arriba = 22, ancho = (W - izq * 2) / dias.length;
  ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center";
  dias.forEach((d, i) => {
    const h = (vals[i] / max) * (H - abajo - arriba), x = izq + i * ancho;
    ctx.fillStyle = d === new Date().toLocaleDateString("en-CA") ? "#f4b400" : "#1f6b3d";
    ctx.fillRect(x + ancho * 0.18, H - abajo - h, ancho * 0.64, Math.max(h, vals[i] ? 2 : 0));
    if (dias.length <= 10 || i % Math.ceil(dias.length / 8) === 0) { ctx.fillStyle = "#5b6b62"; ctx.fillText(String(Number(d.slice(8))), x + ancho / 2, H - 8); }
  });
  const iMax = vals.indexOf(Math.max(...vals));
  if (vals[iMax] > 0) { ctx.fillStyle = "#1c2420"; ctx.fillText(dineroCorto(Math.round(vals[iMax])), izq + iMax * ancho + ancho / 2, H - abajo - (vals[iMax] / max) * (H - abajo - arriba) - 6); }
}
async function respaldar() {
  const datos = { app: "caja-guizar", version: 1, fecha: ahora() };
  for (const t of DB.TABLAS) datos[t] = await DB.todos(t);
  const nombre = `respaldo-caja-${new Date().toLocaleDateString("en-CA")}.json`;
  const f = new File([JSON.stringify(datos)], nombre, { type: "application/json" });
  let ok = false;
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: "Respaldo de mi Caja Guizar" }); ok = true; } catch (e) { if (e.name === "AbortError") return; } }
  if (!ok) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = nombre; a.click(); }
  await ponerAjuste("respaldo", ahora()); avisar("Respaldo listo ✅"); pintarReportes();
}
async function restaurar(e) {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "caja-guizar") throw new Error("Ese archivo no es un respaldo de Caja Guizar");
    if (!confirm(`Respaldo del ${fechaHora(d.fecha)} con ${d.productos?.length || 0} productos, ${d.ventas?.length || 0} ventas y ${d.clientes?.length || 0} clientes. Se reemplazará lo que hay en este teléfono. ¿Seguir?`)) return;
    for (const t of DB.TABLAS) { await DB.vaciar(t); if (Array.isArray(d[t]) && d[t].length) await DB.guardarVarios(t, d[t]); }
    await cargarTodo(); avisar("Datos restaurados ✅"); irA("vender");
  } catch (err) { avisar("No se pudo restaurar: " + err.message, 4000); }
}

// ---------- Datos de ejemplo para probar ----------
async function cargarEjemplo() {
  const P = (nombre, precio, costo, stock, minimo, categoria, codigo) => ({ id: nuevoId(), nombre, precio, costo, stock, minimo, categoria, codigo: codigo || "", vendidos: 0, creado: ahora() });
  const lista = [
    P("Coca-Cola 600 ml", 22, 16.5, 24, 6, "Refrescos", "7501055300075"), P("Agua 1 L", 14, 9, 18, 6, "Refrescos"),
    P("Sabritas 45 g", 21, 15.5, 12, 4, "Botanas"), P("Galletas Marías", 18, 13, 8, 3, "Botanas"),
    P("Leche 1 L", 29, 24.5, 10, 4, "Lácteos"), P("Huevo (pieza)", 3.5, 2.6, 60, 18, "Abarrotes"),
    P("Pan blanco grande", 52, 43, 5, 2, "Abarrotes"), P("Jabón en polvo 1 kg", 46, 37, 3, 3, "Limpieza"),
    P("Tortillas (kg)", 24, 19, null, null, "Tortillería"), P("Recarga $50", 50, 47.5, null, null, "Servicios"),
  ];
  await DB.guardarVarios("productos", lista); S.productos.push(...lista);
  const c = [{ id: nuevoId(), nombre: "Doña Mari", tel: "", limite: 500, nota: "Paga los viernes", creado: ahora() }, { id: nuevoId(), nombre: "Don Chuy", tel: "", limite: 300, nota: "", creado: ahora() }];
  await DB.guardarVarios("clientes", c); S.clientes.push(...c);
  const m = { id: nuevoId(), clienteId: c[0].id, fecha: ahora(), tipo: "cargo", monto: 135, concepto: "Cuenta anterior del cuaderno" };
  await DB.guardar("movimientos", m); S.movimientos.push(m);
  if (!aj("negocio", "")) await ponerAjuste("negocio", "Abarrotes de ejemplo");
  avisar("Listo: 10 productos y 2 clientes de ejemplo"); pintar();
}

// ---------- Arranque ----------
let pedirInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedirInstalar = e; });
const estadoRed = () => { $("sinRed").hidden = navigator.onLine; };
addEventListener("online", estadoRed); addEventListener("offline", estadoRed);
(async () => {
  try {
    await DB.abrir(); await cargarTodo();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { $("vista").innerHTML = `<div class="alerta roja">No pude abrir el almacenamiento del teléfono (${esc(e.message)}). Abre la página en Chrome normal, no en modo incógnito.</div>`; return; }
  estadoRed(); pintar();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
