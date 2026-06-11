// ============================================================
// DETECCIÓN DE DISPOSITIVO
// ============================================================
function esMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

// ============================================================
// CONFIGURACIÓN DE IMPRESORAS
// ============================================================
const IMPRESORAS = {
  // Rutas por defecto. Personaliza según tu red.
  barra: localStorage.getItem('impresora_barra') || 'LPT1:',      // Puerto o IP/hostname de impresora barra
  cocina: localStorage.getItem('impresora_cocina') || 'LPT2:',    // Puerto o IP/hostname de impresora cocina
  // Ejemplos de otros formatos:
  // - Para impresoras locales: 'LPT1:', 'LPT2:', 'COM1:', etc.
  // - Para impresoras en red: '\\\\SERVIDOR\\IMPRESORA' o 'http://192.168.1.100:9100'
};

function obtenerRutaImpresora(destino) {
  // destino: 1 (barra), 2 (cocina)
  if (destino === 1 || destino === '1') return IMPRESORAS.barra;
  if (destino === 2 || destino === '2') return IMPRESORAS.cocina;
  return null;
}

function configurarImpresora(destino, ruta) {
  // Guarda la ruta en localStorage para que persista
  if (destino === 1 || destino === '1') {
    IMPRESORAS.barra = ruta;
    localStorage.setItem('impresora_barra', ruta);
  } else if (destino === 2 || destino === '2') {
    IMPRESORAS.cocina = ruta;
    localStorage.setItem('impresora_cocina', ruta);
  }
}

// ============================================================
// FIN CONFIGURACIÓN
// ============================================================

let mesaId          = null;
let productos       = [];
let lineas          = [];
let lineasIniciales = [];
let comandaId       = null;
let lineasAnteriores = [];
let familias        = [];
let subfamilias     = [];
let familiaActiva   = '__TODAS__';
let categoriaActiva = '__TODAS__';
let favoritos       = JSON.parse(localStorage.getItem('bar_favoritos') || '[]');
let mesaRapida      = false;
let ticketReturnToIndex = false;
let ultimoProductoActualizado = null;
const sonidoPop = new Audio('sounds/pop.mp3');
sonidoPop.volume = 0.75;
let busquedaActiva = false;
let busquedaTexto = '';
let productosCache = [];
let salidaControlada = false;
let liberacionEnviada = false;

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  mesaId   = params.get('id');
  comandaId = params.get('comanda');
  mesaRapida = params.get('quick') === '1';

  if (!mesaId || !comandaId) {
    window.location.href = 'index.html';
    return;
  }

  bindEventos();

  setLoader(true);
  try {
    await cargarProductos();
    await cargarDetalleMesa();
    
    // En mobile, mostrar tab de productos por defecto
    if (esMobile()) {
      switchTab('productos');
    }
  } catch (err) {
    mostrarToast('Error al cargar la mesa: ' + err.message, 'error');
    setTimeout(() => window.location.href = 'index.html', 2000);
  } finally {
    setLoader(false);
  }
});

async function cargarDetalleMesa() {
  const data = await API.getDetalleMesa(mesaId);
  document.getElementById('mesaNombre').textContent = data.mesa.NOMBRE_MESA;

  const todasLineas = data.lineas || [];

  if (comandaId) {
    lineas = todasLineas.filter(l => String(l.comanda_id) === String(comandaId));
    lineasAnteriores = todasLineas.filter(l => String(l.comanda_id) !== String(comandaId));
  } else {
    lineas = todasLineas;
    lineasAnteriores = [];
  }

  lineas = lineas.filter(l => l.estado !== 'SERVIDO');
  lineasAnteriores = lineasAnteriores.filter(l => l.estado !== 'PAGADO');
  lineasIniciales = JSON.parse(JSON.stringify(lineas));

  renderizarPedido();
  renderizarProductos();
}


async function cargarProductos() {
  const [dataProductos, dataCats] = await Promise.all([
    API.getProductos(),
    API.getCategorias()
  ]);
  productos   = dataProductos;
  familias    = dataCats.familias;
  subfamilias = dataCats.subfamilias;
  renderizarFamilias();
  renderizarProductos();
}

function renderizarFamilias() {
  const container = document.getElementById('categoriasTabs');
  const todasBtn = `
  <div class="cat-tab cat-familia ${familiaActiva === '__TODAS__' && categoriaActiva !== '__FAV__' ? 'active' : ''}"
       onclick="setFamilia('__TODAS__')">Todas</div>`;

  const favBtn = `
    <div class="cat-tab cat-familia ${categoriaActiva === '__FAV__' ? 'active' : ''}"
         onclick="setFamilia('__FAV__')" title="Favoritos">⭐</div>`;

  const searchBtn = `
    <div class="cat-tab cat-familia ${busquedaActiva ? 'active' : ''}"
         onclick="toggleBusqueda()" title="Buscar por nombre">🔍</div>`;

  const famBtns = familias.map(f => `
    <div class="cat-tab cat-familia ${familiaActiva === f.FAMILIA && categoriaActiva !== '__FAV__' ? 'active' : ''}"
         onclick="setFamilia(${f.FAMILIA})">${escHtml(f.TEXTO_FAMILIA)}</div>
  `).join('');

  container.innerHTML = todasBtn + favBtn + searchBtn + famBtns;

  renderizarSubfamilias();
}

function toggleBusqueda() {
  const buscador = document.getElementById('productosSearch');
  const input = document.getElementById('busquedaNombre');

  busquedaActiva = !busquedaActiva;
  if (busquedaActiva) {
    categoriaActiva = '__TODAS__';
    familiaActiva = '__TODAS__';
    buscador.style.display = 'block';
    setTimeout(() => input?.focus(), 50);
  } else {
    busquedaTexto = '';
    input.value = '';
    buscador.style.display = 'none';
  }
  renderizarFamilias();
  renderizarProductos();
}

function actualizarBusqueda(valor) {
  busquedaTexto = String(valor || '').trim();
  renderizarProductos();
}

function renderizarSubfamilias() {
  let subContainer = document.getElementById('subfamiliasTabs');
  if (!subContainer) {
    subContainer = document.createElement('div');
    subContainer.id = 'subfamiliasTabs';
    subContainer.className = 'categorias-tabs subfamilias-tabs';
    document.getElementById('categoriasTabs').after(subContainer);
  }

  if (!familiaActiva || categoriaActiva === '__FAV__') {
    subContainer.style.display = 'none';
    return;
  }

  const subs = subfamilias.filter(s => s.FAMILIA_SUBF === familiaActiva);
  if (subs.length === 0) {
    subContainer.style.display = 'none';
    return;
  }

  subContainer.style.display = 'flex';
  const todasBtn = `
    <div class="cat-tab cat-sub ${categoriaActiva === '__TODAS__' ? 'active' : ''}"
         onclick="setSubfamilia('__TODAS__')">Todas</div>`;

  subContainer.innerHTML = todasBtn + subs.map(s => `
    <div class="cat-tab cat-sub ${parseInt(categoriaActiva) === s.SUBFAMILIA ? 'active' : ''}"
         onclick="setSubfamilia(${s.SUBFAMILIA})">${escHtml(s.TEXTO_SUBFAMILIA)}</div>
  `).join('');
}

function setFamilia(familiaId) {
  if (familiaId === '__FAV__') {
    categoriaActiva = '__FAV__';
    familiaActiva   = null;
  } else if (familiaId === '__TODAS__') {
    familiaActiva   = '__TODAS__';
    categoriaActiva = '__TODAS__';
  } else {
    familiaActiva   = familiaId;
    categoriaActiva = '__TODAS__';
  }
  renderizarFamilias();
  renderizarProductos();
}

function setSubfamilia(subId) {
  categoriaActiva = subId;
  renderizarSubfamilias();
  renderizarProductos();
}

function renderizarProductos() {
  const lista = document.getElementById('productosLista');
  if (!lista) return;

  let filtrados = productos.filter(p => {
    if (categoriaActiva === '__FAV__') return favoritos.includes(p.REF);

    if (categoriaActiva === '__TODAS__' && familiaActiva === '__TODAS__') return true;

    if (categoriaActiva === '__TODAS__' && familiaActiva !== null) {
      const subIds = subfamilias
        .filter(s => s.FAMILIA_SUBF === familiaActiva)
        .map(s => s.SUBFAMILIA);
      return subIds.includes(p.SUBFAMILIA_ART);
    }

    return p.SUBFAMILIA_ART === parseInt(categoriaActiva);
  });

  if (busquedaTexto) {
    const texto = busquedaTexto.toLowerCase();
    filtrados = filtrados.filter(p =>
      String(p.TEXTO_ARTICULO).toLowerCase().includes(texto)
    );
  }

  if (filtrados.length === 0) {
    lista.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-light);font-size:14px">Sin resultados</div>`;
    return;
  }

  lista.innerHTML = filtrados.map(p => {
    const lineaActual = lineas.find(l => parseInt(l.producto_id) === parseInt(p.REF));
    const qty         = lineaActual ? parseInt(lineaActual.cantidad) : 0;
    const esFav       = favoritos.includes(p.REF);

    return `
      <div class="producto-row ${qty > 0 ? 'en-pedido' : ''}" id="prod-row-${p.REF}" onclick="agregarProducto(${p.REF})">
        <div class="prod-info">
          <div class="prod-nombre">${escHtml(p.TEXTO_ARTICULO)}</div>
          <div class="prod-cat">${escHtml(p.categoria)}</div>
        </div>
        <button class="fav-btn ${esFav ? 'fav-activo' : ''}" onclick="toggleFavorito(event, ${p.REF})" title="Favorito">★</button>
        <div class="prod-precio">  ${parseFloat(p.PV).toFixed(2).replace('.',',')} €</div>
      </div>`;
  }).join('');
}

function toggleFavorito(event, ref) {
  event.stopPropagation();
  const idx = favoritos.indexOf(ref);
  if (idx === -1) {
    favoritos.push(ref);
  } else {
    favoritos.splice(idx, 1);
  }
  localStorage.setItem('bar_favoritos', JSON.stringify(favoritos));
  renderizarProductos();
}

function renderizarPedido() {
  const lista = document.getElementById('pedidoLista');

  const badge = document.getElementById('tabBadge');
  if (badge) {
    const totalItems = lineas.reduce((s, l) => s + parseInt(l.cantidad), 0);
    badge.textContent = totalItems;
    badge.style.display = totalItems > 0 ? 'inline' : 'none';
  }

  const estadoTag = (estado) => {
    const mapa = {
      'PEDIDO':   ['estado-tag-en-curso', '🟡 En curso'],
      'EN CURSO': ['estado-tag-pedido',   '🔴 Pedido'],
      'LISTO':    ['estado-tag-listo',    '🔵 Listo'],
      'SERVIDO':  ['estado-tag-servido',  '✅ Servido'],
      'PAGADO':   ['estado-tag-pagado',   '🟢 Pagado'],
    };
    const [cls, label] = mapa[estado] || ['estado-tag-otro', estado];
    return `<span class="estado-tag ${cls}">${label}</span>`;
  };

  const renderLineaAnterior = (l) => `
    <div class="pedido-linea linea-bloqueada"
        id="linea-${l.id}"
        onclick="repetirLinea(${l.producto_id}, '${escHtml(l.producto_nombre)}')"
        style="cursor:pointer">

      <div class="pedido-linea-top">
        <div class="pedido-linea-qty">${parseInt(l.cantidad)}</div>
        <div class="pedido-linea-nombre">${escHtml(l.producto_nombre)}</div>
        <div class="pedido-linea-subtotal">${parseFloat(l.subtotal).toFixed(2).replace('.',',')} €</div>
        <div style="font-size:11px;color:var(--gold)">↺</div>
      </div>

      <div class="pedido-linea-bottom">
        ${estadoTag(l.estado)}
        ${l.comentario ? `<div class="comentario-label">${escHtml(l.comentario)}</div>` : ''}
      </div>
    </div>
  `;

  const totalActual   = lineas.reduce((s, l) => s + parseFloat(l.subtotal), 0);
  const totalAnterior = lineasAnteriores.reduce((s, l) => s + parseFloat(l.subtotal), 0);

  lista.innerHTML = `
    <div class="pedido-tabs">
      <button class="pedido-tab active" id="ptabActual" onclick="switchPedidoTab('actual')">
        🟢 Actual <span class="pedido-tab-badge">${lineas.length}</span>
      </button>
      <button class="pedido-tab" id="ptabAnterior" onclick="switchPedidoTab('anterior')">
        📋 Anterior <span class="pedido-tab-badge">${lineasAnteriores.length}</span>
      </button>
    </div>

    <div id="pedidoActual" style="display:flex;flex-direction:column;gap:6px">
      ${lineas.length === 0
        ? '<div class="pedido-empty"><div class="pedido-empty-icon">🛒</div><p>Sin artículos todavía.</p></div>'
        : lineas.map(l => renderLineaActual(l)).join('')
      }
    </div>

    <div id="pedidoAnterior" style="display:none;flex-direction:column;gap:6px">
      ${lineasAnteriores.length === 0
        ? '<div class="pedido-empty"><div class="pedido-empty-icon">📋</div><p>No hay pedidos anteriores.</p></div>'
        : lineasAnteriores.map(l => renderLineaAnterior(l)).join('')
      }
    </div>
  `;

  actualizarTotal(totalActual + totalAnterior);

  if (ultimoProductoActualizado !== null) {

    const linea = [...document.querySelectorAll('.pedido-linea')]
      .find(el => {
        return el.innerHTML.includes(`cambiarCantidad(${ultimoProductoActualizado}`);
      });

    if (linea) {

      linea.classList.add('linea-flash');

      linea.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });

      setTimeout(() => {
        linea.classList.remove('linea-flash');
      }, 300);
    }

    ultimoProductoActualizado = null;
  }
}

async function enviarComentario(event, lineaId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const input = document.getElementById(`comentario-${lineaId}`);
  if (!input) return;

  const texto = input.value.trim();
  if (!texto) return;
  try {
    lineas = await API.agregarComentario(lineaId, texto, mesaId, comandaId);
    renderizarPedido();
    renderizarProductos();
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

function renderLineaActual(l) {
  return `
    <div class="pedido-linea" id="linea-${l.id}">
      <div class="pedido-linea-top">
        <div class="pedido-qty-control">
          <button class="qty-btn minus" onclick="cambiarCantidadLinea(${l.id}, ${l.producto_id}, -1)">−</button>
          <span class="pedido-linea-qty">${parseInt(l.cantidad)}</span>
          <button class="qty-btn plus" onclick="cambiarCantidadLinea(${l.id}, ${l.producto_id}, 1)">+</button>
        </div>
        <div class="pedido-linea-nombre">${escHtml(l.producto_nombre)}</div>
        <div class="pedido-linea-subtotal">${parseFloat(l.subtotal).toFixed(2).replace('.',',')} €</div>
        <button class="pedido-linea-del" onclick="eliminarLineaPorId(${l.id}, ${l.producto_id})">✕</button>
      </div>
      <div class="pedido-comentario-row" onclick="event.stopPropagation()">
        <input class="comentario-input" type="text" placeholder="✏️ Comentario..."
               id="comentario-${l.id}"
               onkeydown="if(event.key==='Enter') enviarComentario(event, ${l.id})"
               maxlength="60"/>
        <button type="button" class="comentario-send-btn" onclick="enviarComentario(event, ${l.id})">→</button>
      </div>
    </div>`;
}

async function restarUnidad(productoId) {
  const linea = lineas.find(l => parseInt(l.producto_id) === parseInt(productoId));
    if (!linea) return;
    const nuevaCant = Math.max(0, parseInt(linea.cantidad) - 1);
      try {
        lineas = await API.actualizarLinea(mesaId, productoId, nuevaCant, comandaId);
        renderizarPedido();
        actualizarFilaProducto(productoId);
      } catch (err) { mostrarToast('Error: ' + err.message, 'error'); }
  }

async function cambiarCantidadLinea(lineaId, productoId, delta) {
  const linea = lineas.find(l => l.id === lineaId);
  if (!linea) return;
  const nuevaCant = Math.max(0, parseInt(linea.cantidad) + delta);
  reproducirPop();
  try {
    lineas = await API.actualizarLineaPorId(lineaId, nuevaCant, mesaId, comandaId);
    renderizarPedido();
    actualizarFilaProducto(productoId);
  } catch (err) { mostrarToast('Error: ' + err.message, 'error'); }
}

function switchPedidoTab(tab) {
  document.getElementById('pedidoActual').style.display   = tab === 'actual'   ? 'flex' : 'none';
  document.getElementById('pedidoAnterior').style.display = tab === 'anterior' ? 'flex' : 'none';
  document.getElementById('ptabActual').classList.toggle('active',   tab === 'actual');
  document.getElementById('ptabAnterior').classList.toggle('active', tab === 'anterior');
}

function actualizarTotal(total) {
  const totalEl = document.getElementById('pedidoTotal');
  if (!totalEl) return;
  totalEl.innerHTML = `${total.toFixed(2).replace('.',',')} <span class="eur">€</span>`;
}

async function cambiarCantidad(productoId, delta) {
  const lineaActual = lineas.find(l => parseInt(l.producto_id) === parseInt(productoId));
  const cantActual  = lineaActual ? parseInt(lineaActual.cantidad) : 0;
  const nuevaCant   = Math.max(0, cantActual + delta);
  feedbackProducto(productoId);

  try {
    lineas = await API.actualizarLinea(mesaId, productoId, nuevaCant, comandaId);
    ultimoProductoActualizado = productoId;
    renderizarPedido();
    actualizarFilaProducto(productoId);
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

async function repetirLinea(productoId, texto) {
  try {
    lineas = await API.repetirLinea(productoId, texto, mesaId, comandaId);
    renderizarPedido();
    actualizarFilaProducto(productoId);
    mostrarToast(`Añadido: ${texto}`, 'success');
  } catch (err) { mostrarToast('Error: ' + err.message, 'error'); }
}

async function agregarProducto(productoId) {
  const lineaActual = lineas.find(
    l => parseInt(l.producto_id) === parseInt(productoId)
  );

  const cantActual = lineaActual
    ? parseInt(lineaActual.cantidad)
    : 0;

  feedbackProducto(productoId);

  try {
    lineas = await API.actualizarLinea(
      mesaId,
      productoId,
      cantActual + 1,
      comandaId
    );

    ultimoProductoActualizado = productoId;

    renderizarPedido();
    actualizarFilaProducto(productoId);

  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

function actualizarFilaProducto(productoId) {
  const lineaActual = lineas.find(
    l => parseInt(l.producto_id) === parseInt(productoId)
  );

  const qty = lineaActual
    ? parseInt(lineaActual.cantidad)
    : 0;

  const rowEl = document.getElementById(`prod-row-${productoId}`);

  if (rowEl) {
    rowEl.classList.toggle('en-pedido', qty > 0);
  }
}

async function eliminarLinea(productoId) {
  try {
    lineas = await API.actualizarLinea(mesaId, productoId, 0, comandaId);
    renderizarPedido();
    actualizarFilaProducto(productoId);
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

async function eliminarLineaPorId(lineaId, productoId) {
  try {
    lineas = await API.actualizarLineaPorId(lineaId, 0, mesaId, comandaId);
    renderizarPedido();
    actualizarFilaProducto(productoId);
  } catch (err) { mostrarToast('Error: ' + err.message, 'error'); }
}

function abrirCobrar() {
  abrirModal('modalCobrarSeleccion');
}

async function cobrarMesaCompleta() {
  cerrarModal('modalCobrarSeleccion');
  salidaControlada = true;
  setLoader(true);
  try {
    const res = await API.cobrarMesa(mesaId, [], 0, true);
    ticketReturnToIndex = true;
    const ticket = res.ticket || res.ticket_completo;
    if (ticket) {
      mostrarTicket(ticket, true);
    } else {
      mostrarToast('Mesa cobrada completa', 'success');
      setTimeout(() => window.location.href = 'index.html', 1200);
    }
  } catch (err) {
    mostrarToast('Error al cobrar completa: ' + err.message, 'error');
  } finally {
    setLoader(false);
  }
}

async function cobrarMesaPorPartes() {
  cerrarModal('modalCobrarSeleccion');
  salidaControlada = true;
  setLoader(true);
  try {
    await API.guardarYSalir(mesaId, comandaId);
    liberarMesa().finally(() => {
      setTimeout(() => {
        window.location.href = `cobro.html?id=${mesaId}`;
      }, 2000);
    });
  } catch (err) {
    mostrarToast('Error al guardar antes de cobrar: ' + err.message, 'error');
    setLoader(false);
  }
}

async function confirmarSalir() {
  salidaControlada = true;
  setLoader(true);
  try {
    const res = await API.guardarYSalir(mesaId, comandaId);
    
    if (res.tickets && res.tickets.length > 0) {
      await procesarTicketsAutomaticos(res.tickets);
    }
    
    cerrarModal('modalSalir');
    window.location.href = 'index.html';
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
    setTimeout(() => window.location.href = 'index.html', 1500);
  } finally {
    setLoader(false);
  }
}

async function procesarTicketsAutomaticos(tickets) {
  for (const ticket of tickets) {
    if (!ticket.lineas || ticket.lineas.length === 0) continue;
    
    const ticketHtml = construirTicketDestino(ticket);
    enviarAImpresora(ticket.destino, ticketHtml);
  }
}

function construirTicketDestino(ticket) {
  const nombre = localStorage.getItem('bar_nombre') || 'MI BAR';
  const destinoNombre = ticket.destino === '1' ? 'BARRA' : (ticket.destino === '2' ? 'COCINA' : 'DESTINO ' + ticket.destino);
  
  const lineas = ticket.lineas.map(l => `
    <tr>
      <td>${parseInt(l.UNIDS)}</td>
      <td>${escHtml(l.TEXTO_ARTICULO || l.TEXTO_LIN)}</td>
      <td>${l.TEXTO_LIN && l.TEXTO_LIN !== l.TEXTO_ARTICULO ? escHtml(l.TEXTO_LIN) : ''}</td>
    </tr>`).join('');

  return `
    <div class="ticket-wrap">
      <div class="ticket-nombre-bar">${escHtml(nombre)}</div>
      <div class="ticket-destino">DESTINO: ${destinoNombre}</div>
      <div class="ticket-fecha">${ticket.fecha}</div>
      <div class="ticket-mesa">Mesa: ${escHtml(ticket.mesa)}</div>
      <div class="ticket-sep">────────────────────</div>
      <table class="ticket-tabla">
        <thead>
          <tr>
            <th style="text-align:center">Ud.</th>
            <th style="text-align:left">Artículo</th>
            <th style="text-align:left">Notas</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>
      <div class="ticket-sep">────────────────────</div>
    </div>`;
}

function enviarAImpresora(destino, ticketHtml) {
  const ruta = obtenerRutaImpresora(destino);
  const nombreDestino = destino === 1 ? 'BARRA' : (destino === 2 ? 'COCINA' : `DESTINO ${destino}`);
  
  console.log(`[IMPRESORA] Enviando a ${nombreDestino} (${ruta}):`, ticketHtml);
  
  // TODO: Integrar con API backend para enviar a impresora real
  // Por ahora solo registra en consola
}

async function crearNuevaMesa() {
  try {
    const data = await API.nuevaMesa();

    const mesaId = data.r_mesa;
    const comandaId = data.r_comanda;

    window.location.href =
      `mesa.html?id=${mesaId}&comanda=${comandaId}`;

  } catch (err) {
    console.error(err);
  }
}
async function confirmarSalirCancelando() {
  salidaControlada = true;
  setLoader(true);
  try {
    await API.borrarLineasCanceladas(mesaId, comandaId);
    if (mesaRapida) {
      await API.estadoMesa(mesaId, 'DISPONIBLE');
    }
    cerrarModal('modalSalir');
    window.location.href = 'index.html';
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
    setTimeout(() => window.location.href = 'index.html', 1500);
  } finally {
    setLoader(false);
  }
}

function liberarMesa() {
  if (!mesaId || liberacionEnviada) return Promise.resolve();
  liberacionEnviada = true;
  const payload = JSON.stringify({ id: mesaId, estado: 'DISPONIBLE' });

  if (navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('api/mesas.php?action=estado', blob);
      return Promise.resolve();
    } catch (error) {
      // fallback to fetch if sendBeacon is not available or fails
    }
  }

  return fetch(`api/mesas.php?action=estado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function handleUnload() {
  if (salidaControlada || !mesaId) return;
  liberarMesa();
}

function buildTicketHtml(ticket) {
  const nombre = localStorage.getItem('bar_nombre') || 'MI BAR';
  const lineas = ticket.lineas.map(l => `
    <tr>
      <td>${escHtml(l.nombre)}</td>
      <td style="text-align:center">${parseInt(l.cantidad)}</td>
      <td style="text-align:right">${parseFloat(l.precio).toFixed(2).replace('.', ',')} €</td>
      <td style="text-align:right">${parseFloat(l.subtotal).toFixed(2).replace('.', ',')} €</td>
    </tr>`).join('');

  return `
    <div class="ticket-wrap">
      <div class="ticket-nombre-bar">${escHtml(nombre)}</div>
      <div class="ticket-fecha">${ticket.fecha}</div>
      <div class="ticket-mesa">Mesa: ${escHtml(ticket.mesa)}</div>
      <div class="ticket-sep">────────────────────</div>
      <div class="ticket-titulo">${escHtml(ticket.titulo || 'Ticket de cobro')}</div>
      <div class="ticket-sep">────────────────────</div>
      <table class="ticket-tabla">
        <thead>
          <tr>
            <th style="text-align:left">Artículo</th>
            <th style="text-align:center">Ud.</th>
            <th style="text-align:right">P.U.</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${lineas}</tbody>
      </table>
      <div class="ticket-sep">────────────────────</div>
      <div class="ticket-total">TOTAL: ${parseFloat(ticket.total).toFixed(2).replace('.', ',')} €</div>
      <div class="ticket-gracias">¡Gracias por su visita!</div>
    </div>`;
}

function mostrarTicket(ticket, autoPrint = false) {
  if (!ticket) return;
  document.getElementById('ticketContenido').innerHTML = buildTicketHtml(ticket);
  abrirModal('modalTicket');
  if (autoPrint) {
    imprimirTicket(true);
  }
}

function cerrarTicket() {
  cerrarModal('modalTicket');
  if (ticketReturnToIndex) {
    ticketReturnToIndex = false;
    window.location.href = 'index.html';
  }
}

function imprimirTicket(auto = false) {
  const contenido = document.getElementById('ticketContenido').innerHTML;
  const ventana = window.open('', '_blank', 'width=400,height=600');
  ventana.document.write(`
    <!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Ticket</title>
    <style>
      body { font-family: monospace; font-size: 13px; margin: 20px; }
      .ticket-nombre-bar { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 4px; }
      .ticket-fecha, .ticket-mesa { text-align: center; font-size: 12px; color: #555; }
      .ticket-sep { text-align: center; margin: 8px 0; color: #aaa; }
      .ticket-tabla { width: 100%; border-collapse: collapse; margin: 8px 0; }
      .ticket-tabla th { border-bottom: 1px solid #000; padding: 3px 4px; font-size: 12px; }
      .ticket-tabla td { padding: 3px 4px; font-size: 12px; }
      .ticket-total { font-size: 16px; font-weight: bold; text-align: right; margin-top: 8px; }
      .ticket-gracias { text-align: center; margin-top: 12px; font-size: 12px; color: #777; }
    </style>
    </head><body>${contenido}</body></html>
  `);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => {
    ventana.print();
    if (auto) {
      ventana.close();
      if (ticketReturnToIndex) {
        ticketReturnToIndex = false;
        window.location.href = 'index.html';
      }
    }
  }, 300);
}

window.addEventListener('beforeunload', handleUnload);
window.addEventListener('pagehide', handleUnload);

window.crearNuevaMesa = async function () {
  const nombre = document.getElementById('inputNombreMesa').value || 'Mesa sin nombre';

  try {
    const data = await API._fetch(`${API.base}api/nueva_mesa.php`, {
      method: 'POST',
      headers: API._headers(),
      body: JSON.stringify({ nombre })
    });

    const mesaId = data.r_mesa;
    const comandaId = data.r_comanda;

    window.location.href =
      `mesa.html?id=${mesaId}&comanda=${comandaId}`;

  } catch (err) {
    console.error(err);
    alert(err.message);
  }
  };
  
function bindEventos() {
  const btnSalir = document.getElementById('btnSalir');
  if (btnSalir) btnSalir.addEventListener('click', confirmarSalirCancelando);

  const btnGuardar = document.getElementById('btnGuardar');
  if (btnGuardar) {
    if (mesaRapida) {
      btnGuardar.textContent = '⚡ Cobrar y salir';
      btnGuardar.classList.remove('btn-success');
      btnGuardar.classList.add('btn-primary');
      btnGuardar.addEventListener('click', cobrarMesaCompleta);
    } else {
      btnGuardar.addEventListener('click', confirmarSalir);
    }
  }

  const btnCobrar = document.getElementById('btnCobrar');
  if (btnCobrar) btnCobrar.addEventListener('click', abrirCobrar);

  const busquedaInput = document.getElementById('busquedaNombre');
  if (busquedaInput) {
    busquedaInput.addEventListener('input', e => actualizarBusqueda(e.target.value));
  }
}

function switchTab(tab) {
  const productosPanel = document.querySelector('.productos-panel');
  const pedidoPanel    = document.querySelector('.pedido-panel');
  const tabProductos   = document.getElementById('tabProductos');
  const tabPedido      = document.getElementById('tabPedido');

  if (tab === 'productos') {
    productosPanel.classList.remove('tab-hidden');
    pedidoPanel.classList.add('tab-hidden');
    tabProductos.classList.add('active');
    tabPedido.classList.remove('active');
  } else {
    pedidoPanel.classList.remove('tab-hidden');
    productosPanel.classList.add('tab-hidden');
    tabPedido.classList.add('active');
    tabProductos.classList.remove('active');
  }
}

async function cambiarComentario(lineaId, nuevoComentario) {
  const linea = lineas.find(l => l.id === lineaId);
  if (!linea) return;
  if ((linea.comentario || '') === nuevoComentario.trim()) return;
  try {
    lineas = await API.actualizarLineaEstado(mesaId, lineaId, linea.estado, nuevoComentario.trim());
    renderizarPedido();
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

function reproducirPop() {

  sonidoPop.currentTime = 0;

  sonidoPop.play().catch(() => {});
}

function feedbackProducto(productoId) {
  reproducirPop();
  const row = document.getElementById(`prod-row-${productoId}`);
  if (!row) return;
  row.classList.remove('producto-flash');
  void row.offsetWidth;
  row.classList.add('producto-flash');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}