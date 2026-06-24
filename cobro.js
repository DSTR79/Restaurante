const params = new URLSearchParams(window.location.search);

let mesaActiva = params.get('id') || null;
let currentComandaId = null;
let lineasCobro = [];
let totalPte = 0;
let accionPendiente = null;
let numPartes = 2;
let ticketQueue = [];
let ticketReturnToMesas = false;
let ticketReturnToIndex = false;
let mesaCobrado = false;
let reloadAfterTickets = false;
let metodoPagoSeleccionado = null;

let mesasDisponibles = [];
let mesaSeleccionadaExtra = null;
let productosSeleccionadosExtra = {};
let mesasBloquedadasExtra = []; 
let itemsExtraAnadidos = [];

async function abrirAnadirDesdeMesa() {
  setLoader(true);
  try {
    mesasDisponibles = await API.getMesasDisponiblesConLineas(mesaActiva);
    
    if (!mesasDisponibles || !Array.isArray(mesasDisponibles) || mesasDisponibles.length === 0) {
      mostrarToast('No hay mesas disponibles con consumo pendiente', 'warning');
      setLoader(false);
      return;
    }

    mesaSeleccionadaExtra = null;
    productosSeleccionadosExtra = {};
    mesasBloquedadasExtra = [];
    
    renderizarMesasDisponibles();
    abrirModal('modalAnadirDesdeMesa');
  } catch (err) {
    console.error('Error al cargar mesas:', err);
    mostrarToast('Error al cargar mesas: ' + err.message, 'error');
  } finally {
    setLoader(false);
  }
}

function renderizarMesasDisponibles() {
  const container = document.getElementById('anadirMesasContenedor');
  
  if (!mesasDisponibles.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">No hay mesas disponibles</div>';
    return;
  }

  const html = mesasDisponibles.map(m => `
    <button class="anadirmesa-mesa-btn ${mesaSeleccionadaExtra === m.mesa ? 'active' : ''}" 
            onclick="seleccionarMesaExtra(${m.mesa})">
      ${escHtml(m.nombre)}<br>
      <small style="opacity:.7">${parseFloat(m.total_pte).toFixed(2).replace('.', ',')} €</small>
    </button>
  `).join('');

  container.innerHTML = `<div class="anadirmesa-mesas-grid">${html}</div>`;
}

function seleccionarMesaExtra(mesaId) {
  mesaSeleccionadaExtra = mesaId;
  productosSeleccionadosExtra = {};
  
  const mesa = mesasDisponibles.find(m => m.mesa === mesaId);
  
  if (mesa) {
    document.getElementById('anadirMesaNombre').textContent = escHtml(mesa.nombre);
    renderizarProductosMesa(mesa.lineas);
    document.getElementById('anadirProductosContenedor').style.display = 'block';
    document.getElementById('anadirResumen').style.display = 'block';
  }
  
  renderizarMesasDisponibles();
  actualizarResumenAnadir();
}

function renderizarProductosMesa(lineas) {
  const container = document.getElementById('anadirProductosLista');
  
  if (!lineas.length) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">No hay productos pendientes</div>';
    return;
  }

  const html = lineas.map(l => {
    const cantidad = productosSeleccionadosExtra[l.producto_id] || 0;
    return `
      <div class="anadirmesa-producto-item">
        <div class="anadirmesa-producto-info">
          <div class="anadirmesa-producto-nombre">${escHtml(l.producto_nombre)}</div>
          <div class="anadirmesa-producto-precio">${parseFloat(l.precio_unitario).toFixed(2).replace('.', ',')} €</div>
          <div class="anadirmesa-producto-disponible">Disponible: ${l.cantidad_total}</div>
        </div>
        <div class="anadirmesa-qty-control">
          <button class="anadirmesa-qty-btn" onclick="cambiarCantidadExtra(${l.producto_id}, -1, ${l.cantidad_total})">−</button>
          <div class="anadirmesa-qty-display">${cantidad}</div>
          <button class="anadirmesa-qty-btn" onclick="cambiarCantidadExtra(${l.producto_id}, 1, ${l.cantidad_total})">+</button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function cambiarCantidadExtra(productoId, delta, max) {
  const actual = productosSeleccionadosExtra[productoId] || 0;
  const nueva = Math.min(max, Math.max(0, actual + delta));
  
  if (nueva === 0) {
    delete productosSeleccionadosExtra[productoId];
  } else {
    productosSeleccionadosExtra[productoId] = nueva;
  }
  
  const mesa = mesasDisponibles.find(m => m.mesa === mesaSeleccionadaExtra);
  if (mesa) {
    renderizarProductosMesa(mesa.lineas);
  }
  
  actualizarResumenAnadir();
}

function actualizarResumenAnadir() {
  const mesa = mesasDisponibles.find(m => m.mesa === mesaSeleccionadaExtra);
  if (!mesa) return;
  
  let total = 0;
  const items = [];
  
  Object.entries(productosSeleccionadosExtra).forEach(([productoId, cantidad]) => {
    const linea = mesa.lineas.find(l => l.producto_id == productoId);
    if (linea) {
      const subtotal = cantidad * parseFloat(linea.precio_unitario);
      total += subtotal;
      items.push(`
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
          <span>${escHtml(linea.producto_nombre)} x${cantidad}</span>
          <strong>${subtotal.toFixed(2).replace('.', ',')} €</strong>
        </div>
      `);
    }
  });
  
  document.getElementById('anadirResumenItems').innerHTML = items.join('');
  document.getElementById('anadirResumenTotal').textContent = total.toFixed(2).replace('.', ',') + ' €';
  document.getElementById('btnAnadirConfirmar').disabled = total === 0;
}

async function confirmarAnadirDesdeMesa() {
  if (!mesaSeleccionadaExtra || Object.keys(productosSeleccionadosExtra).length === 0) {
    mostrarToast('Selecciona productos', 'warning');
    return;
  }

  try {
    const mesaSeleccionada = mesasDisponibles.find(m => m.mesa === mesaSeleccionadaExtra);
    if (!mesaSeleccionada) {
      mostrarToast('Error: Mesa no encontrada', 'error');
      return;
    }
    
    await API.estadoMesa(mesaSeleccionadaExtra, 'OCUPADA');
    mesasBloquedadasExtra.push(mesaSeleccionadaExtra);
    
    const itemsExtra = Object.entries(productosSeleccionadosExtra).map(([productoId, cantidad]) => {
      const linea = mesaSeleccionada.lineas.find(l => l.producto_id == productoId);
      if (!linea) {
        return null;
      }
      return {
        producto_id: parseInt(productoId),
        cantidad: cantidad,
        precio_unitario: parseFloat(linea.precio_unitario),
        mesa_origen: mesaSeleccionadaExtra,
        mesa_origen_nombre: mesaSeleccionada.nombre
      };
    }).filter(item => item !== null);
    
    itemsExtraAnadidos = itemsExtra;
    
    cerrarModalAnadirMesa();
    
    renderizarCobro();
    recalcularSel();
    
    mostrarToast(`${itemsExtra.length} producto(s) añadido(s) desde ${mesaSeleccionada.nombre}`, 'success');
  } catch (err) {
    mostrarToast('Error al bloquear mesa: ' + err.message, 'error');
  }
}

function cerrarModalAnadirMesa() {
  cerrarModal('modalAnadirDesdeMesa');
  mesaSeleccionadaExtra = null;
  productosSeleccionadosExtra = {};
  document.getElementById('anadirProductosContenedor').style.display = 'none';
  document.getElementById('anadirResumen').style.display = 'none';
}

async function liberarMesasExtrasBloqueadas() {
  for (const mesaId of mesasBloquedadasExtra) {
    try {
      await API.estadoMesa(mesaId, 'DISPONIBLE');
    } catch (err) {
      console.warn('No se pudo liberar mesa extra:', mesaId, err);
    }
  }
  mesasBloquedadasExtra = [];
}


document.addEventListener('DOMContentLoaded', async () => {

  try {
    const mesas = await API.getMesas();
    renderizarMesas(mesas);
    if (mesaActiva) {
      try {
        await entrarMesa(mesaActiva, "Mesa " + mesaActiva);
      } catch (err) {
        mostrarToast('Mesa no encontrada o ya cerrada.', 'warning');
        setTimeout(() => window.location.href = 'index.html', 1000);
      }
    }
    setInterval(cargarMesas, 10000);
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
    if (mesaActiva) {
      setTimeout(() => window.location.href = 'index.html', 1200);
    }
  }
});
async function cargarMesas() {
  if (mesaActiva) return;

  try {
    const mesas = await API.getMesas();
    renderizarMesas(mesas);
  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
  }
}

function renderizarMesas(mesas) {
  const grid = document.getElementById('cobroMesasGrid');

  const cobrable = mesas.filter(m => m.ESTADO !== 'COBRADA' && parseFloat(m.TOTAL_PTE) > 0);

  if (!cobrable.length) {
    grid.innerHTML = `
      <div class="cobro-empty">
        <div style="font-size:48px;opacity:.3">💶</div>
        <p>No hay mesas con consumo pendiente</p>
      </div>`;
    return;
  }

  grid.innerHTML = cobrable.map(m => {

    const pendiente = parseFloat(m.TOTAL_PTE) > 0;

    let css = '';
    let estadoTxt = '';

    if (m.ESTADO === 'OCUPADA') {
      css = 'mesa-roja';
      estadoTxt = '🔴 Ocupada';
    } 
    else if (pendiente) {
      css = 'mesa-amarilla';
      estadoTxt = '🟡 Pendiente';
    } 
    else {
      css = 'mesa-verde';
      estadoTxt = '🟢 Cobrada';
    }

    return `
      <div class="cobro-mesa-card ${css}" id="cobro-mesa-${m.MESA}" data-estado="${m.ESTADO}"
           onclick="entrarMesa(${m.MESA}, '${escHtml(m.NOMBRE)}')">

        <div class="cobro-mesa-nombre">${escHtml(m.NOMBRE)}</div>

        <div class="cobro-mesa-estado">${estadoTxt}</div>

        <div class="cobro-mesa-total">
          ${parseFloat(m.TOTAL_PTE || 0).toFixed(2).replace('.', ',')} €
        </div>

        ${m.ABIERTO_POR
          ? `<div class="cobro-mesa-cam">👤 ${escHtml(m.ABIERTO_POR)}</div>`
          : ''}
      </div>
    `;
  }).join('');
}

async function entrarMesa(id, nombre) {
  const card = document.getElementById(`cobro-mesa-${id}`);
  const estado = card?.dataset?.estado;
  if (estado === 'OCUPADA') {
    mostrarToast('Esta mesa está ocupada, no puedes entrar ahora.', 'warning');
    return;
  }

  mesaActiva = id;
  mesaCobrado = false;
  ticketReturnToMesas = false;

  document.getElementById('cobroMesaNombre').textContent = nombre;

  setLoader(true);

  try {
    await API.estadoMesa(id, 'OCUPADA');

    const data = await API.getLineasCobro(id);

    lineasCobro = data.lineas;
    totalPte = parseFloat(data.total_pte || 0);
    currentComandaId = data.comanda_id || null;

    renderizarCobro();

    document.getElementById('vistasMesas').style.display = 'none';
    document.getElementById('vistaCobro').style.display = 'block';

  } catch (err) {
    mostrarToast('Error: ' + err.message, 'error');
    mesaActiva = null;
  } finally {
    setLoader(false);
  }
}

async function volverMesas(skipEstado = false) {
  if (mesaActiva && !skipEstado && !mesaCobrado) {
    try {
      await API.estadoMesa(mesaActiva, 'DISPONIBLE');
    } catch (err) {
      mostrarToast('No se pudo liberar la mesa: ' + err.message, 'error');
    }
  }
  
  mesaActiva = null;

  document.getElementById('vistaCobro').style.display = 'none';
  document.getElementById('vistasMesas').style.display = 'block';

  cargarMesas();
}

async function volverAMesa() {

  if (mesaActiva && !mesaCobrado) {
    try {
      await API.estadoMesa(mesaActiva, 'DISPONIBLE');
    } catch (err) {
      mostrarToast('No se pudo liberar la mesa: ' + err.message, 'error');
    }
  }
  
  itemsExtraAnadidos = [];
  window.itemsExtraParaCobro = null;
  mesasBloquedadasExtra = [];
  
  window.location.href = 'index.html';
}

function renderizarCobro() {
  let totalConExtra = totalPte;
  if (itemsExtraAnadidos.length > 0) {
    itemsExtraAnadidos.forEach(item => {
      totalConExtra += item.cantidad * parseFloat(item.precio_unitario);
    });
  }

  document.getElementById('cobroTotalPte').textContent =
    totalConExtra.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('resumenPte').textContent =
    totalConExtra.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('resumenSel').textContent = '0,00 €';

  document.getElementById('btnCobrarSel').disabled = true;

  const container = document.getElementById('cobroLineas');

  if (!lineasCobro.length && itemsExtraAnadidos.length === 0) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-light)">
        No hay artículos pendientes
      </div>
    `;
    return;
  }

  const pendientes = [];
  const cobradas = [];

  lineasCobro.forEach(l => {
    const pendiente = parseInt(l.cantidad_total) || 0;
    const pagada = parseInt(l.cantidad_pagada) || 0;
    const estaCobrada = pendiente === 0 && pagada > 0;

    if (estaCobrada) {
      cobradas.push(`
        <div class="cobro-articulo-row pagada" id="cobart-${l.producto_id}">
          <div class="cobro-art-info">
            <div class="cobro-art-nombre">${escHtml(l.producto_nombre)}</div>
            <div class="cobro-art-meta">
              <span class="cobro-art-tag">Cobrado: ${pagada}</span>
            </div>
          </div>
          <div class="cobro-art-total">${(pagada * parseFloat(l.precio_unitario)).toFixed(2).replace('.', ',')} €</div>
        </div>
      `);
    } else {
      pendientes.push(`
        <div class="cobro-articulo-row" id="cobart-${l.producto_id}">
          <div class="cobro-art-info">
            <div class="cobro-art-nombre">${escHtml(l.producto_nombre)}</div>
            <div class="cobro-art-precio">
              ${parseFloat(l.precio_unitario).toFixed(2).replace('.', ',')} €
            </div>
            <div class="cobro-art-meta">
              <span>${pendiente} pendiente</span>
              ${pagada ? `<span class="cobro-art-tag">Cobrado: ${pagada}</span>` : ''}
            </div>
          </div>
          <div class="cobro-art-qty-ctrl">
            <button class="qty-btn minus" onclick="cambiarCobroQty(${l.producto_id}, -1, ${pendiente}, ${parseFloat(l.precio_unitario)})">−</button>
            <div class="cobro-qty-display">
              <span id="cobroqty-${l.producto_id}">0</span>
              <span class="cobro-qty-max">/ ${pendiente}</span>
            </div>
            <button class="qty-btn plus" onclick="cambiarCobroQty(${l.producto_id}, 1, ${pendiente}, ${parseFloat(l.precio_unitario)})">+</button>
          </div>
          <div id="cobrosub-${l.producto_id}" class="cobro-art-subtotal">0,00 €</div>
        </div>
      `);
    }
  });

  container.innerHTML = `
    ${pendientes.length > 0 ? `
      <div class="cobro-group">
        <div class="cobro-group-title">Artículos pendientes</div>
        ${pendientes.join('')}
      </div>
    ` : ''}
    ${itemsExtraAnadidos.length > 0 ? `
      <div class="cobro-group">
        <div class="cobro-group-title" style="background:var(--blue-100);color:var(--blue-800);border-bottom:2px solid var(--blue-300)">🔗 De otras mesas (no modificables)</div>
        ${itemsExtraAnadidos.map(item => `
          <div class="cobro-articulo-row" style="opacity:0.7;background:var(--blue-50);border-left:3px solid var(--blue-600)">
            <div class="cobro-art-info">
              <div class="cobro-art-nombre">${escHtml(item.producto_nombre || 'Producto')}</div>
              <div class="cobro-art-precio">
                ${parseFloat(item.precio_unitario).toFixed(2).replace('.', ',')} €
              </div>
              <div class="cobro-art-meta">
                <span style="color:var(--blue-700);font-weight:bold;">${item.cantidad} unidad(es) • De ${escHtml(item.mesa_origen_nombre)}</span>
              </div>
            </div>
            <div class="cobro-art-total" style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
              <div>${(item.cantidad * parseFloat(item.precio_unitario)).toFixed(2).replace('.', ',')} €</div>
              <button class="btn btn-sm btn-danger" onclick="eliminarItemExtra(${item.producto_id}, ${item.mesa_origen})" style="padding:4px 8px;font-size:12px;">🗑️ Quitar</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${cobradas.length > 0 ? `
      <div class="cobro-group">
        <div class="cobro-group-title">Artículos cobrados</div>
        ${cobradas.join('')}
      </div>
    ` : ''}
  `;
}

function cambiarCobroQty(productoId, delta, max, precio) {
  const el = document.getElementById(`cobroqty-${productoId}`);

  const actual = parseInt(el.textContent) || 0;
  const nueva = Math.min(max, Math.max(0, actual + delta));

  el.textContent = nueva;

  document.getElementById(`cobrosub-${productoId}`).textContent =
    (nueva * precio).toFixed(2).replace('.', ',') + ' €';

  recalcularSel();
}

function recalcularSel() {
  let total = 0;

  document.querySelectorAll('[id^="cobroqty-"]').forEach(el => {
    const qty = parseInt(el.textContent) || 0;

    if (qty > 0) {
      const id = el.id.replace('cobroqty-', '');
      const sub = document.getElementById(`cobrosub-${id}`).textContent;

      total += parseFloat(sub.replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
    }
  });

  // Agregar items extra al total seleccionado
  if (itemsExtraAnadidos.length > 0) {
    itemsExtraAnadidos.forEach(item => {
      total += item.cantidad * parseFloat(item.precio_unitario);
    });
  }

  document.getElementById('resumenSel').textContent =
    total.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('btnCobrarSel').disabled = total === 0;
}

function eliminarItemExtra(productoId, mesaOrigen) {
  itemsExtraAnadidos = itemsExtraAnadidos.filter(item => 
    !(item.producto_id === productoId && item.mesa_origen === mesaOrigen)
  );
  
  if (itemsExtraAnadidos.length === 0) {
    const idx = mesasBloquedadasExtra.indexOf(mesaOrigen);
    if (idx > -1) {
      mesasBloquedadasExtra.splice(idx, 1);
      // Liberar mesa en BD
      API.estadoMesa(mesaOrigen, 'DISPONIBLE').catch(err => 
        console.warn('No se pudo liberar mesa:', mesaOrigen, err)
      );
    }
  }
  
  renderizarCobro();
  recalcularSel();
  mostrarToast('Producto removido', 'info');
}

function abrirConfirmar(tipo) {
  accionPendiente = tipo;
  metodoPagoSeleccionado = 'efectivo';

  document.getElementById('btnPagoEfectivo').classList.add('btn-primary');
  document.getElementById('btnPagoEfectivo').classList.remove('btn-outline');
  document.getElementById('btnPagoTarjeta').classList.add('btn-outline');
  document.getElementById('btnPagoTarjeta').classList.remove('btn-primary');
  document.getElementById('modalPagoAviso').style.display = 'none';
  document.getElementById('btnConfirmarCobro').disabled = false;

  const esTodo = tipo === 'todo';
  
  document.getElementById('opcionFacturaCompleta').style.display = esTodo ? 'block' : 'none';
  document.getElementById('checkFacturaCompleta').checked = false;

  const importe = esTodo
    ? totalPte
    : parseFloat(document.getElementById('resumenSel').textContent.replace(',', '.').replace(/[^0-9.]/g, ''));

  document.getElementById('modalConfirmarTitulo').textContent =
    esTodo ? 'Cobrar mesa' : 'Cobrar selección';

  document.getElementById('modalImporte').textContent =
    importe.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('btnConfirmarCobro').onclick = ejecutarCobro;
  abrirModal('modalConfirmar');
}

function seleccionarMetodoPago(metodo) {
  metodoPagoSeleccionado = metodo;

  const btnEfectivo = document.getElementById('btnPagoEfectivo');
  const btnTarjeta = document.getElementById('btnPagoTarjeta');
  const aviso = document.getElementById('modalPagoAviso');
  const btnConfirmar = document.getElementById('btnConfirmarCobro');

  if (metodo === 'efectivo') {
    btnEfectivo.classList.add('btn-primary');
    btnEfectivo.classList.remove('btn-outline');
    btnTarjeta.classList.add('btn-outline');
    btnTarjeta.classList.remove('btn-primary');
    aviso.style.display = 'none';
    btnConfirmar.disabled = false;
  } else {
    btnTarjeta.classList.remove('btn-outline');
    btnTarjeta.classList.add('btn-primary');
    btnEfectivo.classList.add('btn-outline');
    btnEfectivo.classList.remove('btn-primary');
    aviso.style.display = 'block';
    btnConfirmar.disabled = true;
  }
}

function abrirDividir() {
  numPartes = 2;
  actualizarDividir();
  abrirModal('modalDividir');
}

function cambiarPartes(delta) {
  numPartes = Math.max(2, numPartes + delta);
  actualizarDividir();
}

function actualizarDividir() {
  document.getElementById('numPartes').textContent = numPartes;

  document.getElementById('importeParte').textContent =
    (totalPte / numPartes).toFixed(2).replace('.', ',') + ' €';
}

function cobrarParte() {
  if (totalPte <= 0) {
    mostrarToast('No hay importe pendiente para dividir.', 'info');
    return;
  }

  const importe = totalPte / numPartes;
  document.getElementById('importeParte').textContent =
    importe.toFixed(2).replace('.', ',') + ' €';

  mostrarToast(`Cada parte: ${importe.toFixed(2).replace('.', ',')} €`, 'success');
  cerrarModal('modalDividir');
}

async function liberarMesaCobro() {
  if (!mesaActiva) return;
  try {
    await API.estadoMesa(mesaActiva, 'DISPONIBLE');
  } catch (err) {
    console.warn('No se pudo liberar la mesa:', err.message);
  }
}

function liberarMesaCobroSync() {
  if (!mesaActiva) return;

  const payload = JSON.stringify({ id: mesaActiva, estado: 'DISPONIBLE' });

  if (navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('api/mesas.php?action=estado', blob);
      return;
    } catch (error) {
    }
  }

  fetch('api/mesas.php?action=estado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function handleCobroUnload() {
  if (mesaActiva && !mesaCobrado) {
    liberarMesaCobroSync();
  }
  if (mesasBloquedadasExtra.length > 0) {
    mesasBloquedadasExtra.forEach(mesaId => {
      fetch('api/mesas.php?action=estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mesaId, estado: 'DISPONIBLE' }),
        keepalive: true
      }).catch(() => {});
    });
  }
}

window.addEventListener('beforeunload', handleCobroUnload);
window.addEventListener('pagehide', handleCobroUnload);

async function ejecutarCobro() {
  if (metodoPagoSeleccionado === 'tarjeta') {
    mostrarToast('Pago con tarjeta en desarrollo. Usa efectivo por ahora.', 'warning');
    return;
  }

  cerrarModal('modalConfirmar');
  setLoader(true);
  
  const facturarCompleto = accionPendiente === 'todo' && document.getElementById('checkFacturaCompleta').checked;
  const itemsExtra = itemsExtraAnadidos || [];
  
  try {
    const res = await API.cobrarMesa(mesaActiva, 
      accionPendiente === 'todo' ? [] : obtenerItemsSeleccionados(),
      accionPendiente === 'todo' ? 0 : obtenerTotalSeleccionado(),
      accionPendiente === 'todo'
    );

    ticketQueue = [];
    const mesaCobrada = res.mesa_cobrada === true;
    
    if (itemsExtra.length > 0) {
      for (const item of itemsExtra) {
        try {
          const resExtra = await API.cobrarMesa(item.mesa_origen, 
            [{ producto_id: item.producto_id, cantidad: item.cantidad, precio_unitario: item.precio_unitario }],
            item.cantidad * item.precio_unitario,
            false
          );
          if (resExtra.ticket) {
            // Marcar ticket con origen
            resExtra.ticket.titulo = `Cobro - ${escHtml(item.mesa_origen_nombre)}`;
            resExtra.ticket.mesa_origen = item.mesa_origen;
            ticketQueue.push(resExtra.ticket);
          }
        } catch (err) {
          console.warn('Error cobrar mesa extra:', item.mesa_origen, err);
        }
      }
    }
    
    if (res.ticket) {
      res.ticket.titulo = `Cobro - ${document.getElementById('cobroMesaNombre').textContent}`;
      ticketQueue.unshift(res.ticket);
    }
    
    if (facturarCompleto && res.ticket_completo) {
      res.ticket_completo.titulo = 'Ticket completo de mesa';
      ticketQueue.push(res.ticket_completo);
    }
    
    if (mesaCobrada) {
      try {
        await API.estadoMesa(mesaActiva, 'COBRADA');
      } catch (err) {
        console.warn('No se pudo actualizar estado a COBRADA:', err.message);
      }
      mesaCobrado = true;
      ticketReturnToMesas = true;
    }

    reloadAfterTickets = accionPendiente === 'todo' && !mesaCobrada;
    
    if (accionPendiente === 'seleccion') {
      ticketReturnToIndex = true;
      await liberarMesasExtrasBloqueadas();
      itemsExtraAnadidos = [];
      setLoader(false);
      liberarMesaCobro().finally(() => {
        window.location.href = 'index.html';
      });
      if (ticketQueue.length) {
        procesarTicketQueueBackground();
      }
      return;
    }

    await liberarMesasExtrasBloqueadas();
    itemsExtraAnadidos = [];

    if (ticketQueue.length) {
      procesarTicketQueue();
    } else {
      mostrarToast('Cobro registrado', 'success');
      if (mesaCobrada) {
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1200);
      } else if (reloadAfterTickets) {
        window.location.reload();
      } else if (ticketReturnToIndex) {
        await liberarMesaCobro();
        window.location.href = 'index.html';
      } else {
        await entrarMesa(mesaActiva, document.getElementById('cobroMesaNombre').textContent);
      }
    }
  } catch (err) { 
    mostrarToast('Error: ' + err.message, 'error');
    console.error('Error en cobro, mesas extras permanecen bloqueadas para reintentar:', mesasBloquedadasExtra);
  }
  finally { setLoader(false); }
}

function obtenerItemsSeleccionados() {
  return Array.from(document.querySelectorAll('[id^="cobroqty-"]'))
    .filter(el => parseInt(el.textContent) > 0)
    .map(el => {
      const pid   = el.id.replace('cobroqty-', '');
      const linea = lineasCobro.find(l => parseInt(l.producto_id) === parseInt(pid));
      return { producto_id: parseInt(pid), cantidad: parseInt(el.textContent), precio_unitario: parseFloat(linea.precio_unitario) };
    });
}

function obtenerTotalSeleccionado() {
  return parseFloat(document.getElementById('resumenSel').textContent.replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
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

  const tituloMesa = ticket.titulo ? `<div class="ticket-titulo">${escHtml(ticket.titulo)}</div>` : '';

  return `
    <div class="ticket-wrap">
      <div class="ticket-nombre-bar">${escHtml(nombre)}</div>
      <div class="ticket-fecha">${ticket.fecha}</div>
      <div class="ticket-mesa">Mesa: ${escHtml(ticket.mesa)}</div>
      <div class="ticket-sep">────────────────────</div>
      ${tituloMesa}
      ${tituloMesa ? '<div class="ticket-sep">────────────────────</div>' : ''}
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
  const html = buildTicketHtml(ticket);
  document.getElementById('ticketContenido').innerHTML = html;

  if (autoPrint) {
    imprimirTicket(true);
    return;
  }

  abrirModal('modalTicket');
}

function procesarTicketQueue() {
  if (!ticketQueue.length) {
    ticketQueue = [];
    if (reloadAfterTickets) {
      reloadAfterTickets = false;
      window.location.reload();
      return;
    }
    if (ticketReturnToIndex) {
      ticketReturnToIndex = false;
      liberarMesaCobro().finally(() => {
        window.location.href = 'index.html';
      });
      return;
    }
    if (ticketReturnToMesas || mesaCobrado) {
      ticketReturnToMesas = false;
      window.location.href = 'index.html';
    } else {
      entrarMesa(mesaActiva, document.getElementById('cobroMesaNombre').textContent);
    }
    return;
  }

  const ticket = ticketQueue.shift();
  mostrarTicket(ticket, true);
}

function procesarTicketQueueBackground() {
  if (!ticketQueue.length) return;
  const ticket = ticketQueue.shift();
  const ticketData = {
    nombre: localStorage.getItem('bar_nombre') || 'MI BAR',
    fecha:  ticket.fecha || '',
    mesa:   ticket.mesa || '',
    titulo: ticket.titulo || '',
    total:  ticket.total || 0,
    lineas: (ticket.lineas || []).map(l => ({
      nombre:   l.nombre || '',
      cantidad: l.cantidad || 0,
      precio:   l.precio || 0,
      subtotal: l.subtotal || 0
    }))
  };
  const anchoPapel = 78;
  const contenido = buildTicketHtml(ticket);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${getTicketStyles(anchoPapel)}</style></head><body>${contenido}</body></html>`;
  imprimirDirecto(html, () => setTimeout(() => procesarTicketQueueBackground(), 300), ticketData);
}

function cerrarTicket() {
  if (ticketQueue.length) {
    mostrarTicket(ticketQueue.shift());
    return;
  }

  ticketQueue = [];
  cerrarModal('modalTicket');

  if (ticketReturnToIndex) {
    ticketReturnToIndex = false;
    liberarMesaCobro().finally(() => {
      window.location.href = 'index.html';
    });
    return;
  }
  if (ticketReturnToMesas || mesaCobrado) {
    ticketReturnToMesas = false;
    window.location.href = 'index.html';
  } else {
    liberarMesaCobro().finally(() => {
      window.location.href = 'index.html';
    });
  }
}

const PRINT_URL = 'http://localhost:9100';

function ticketToPlainText(ticket) {
  const W = 32; // ancho chars para 80mm
  const sep = '='.repeat(W);
  const cent = s => s.length >= W ? s : ' '.repeat(Math.floor((W - s.length) / 2)) + s;
  const pad  = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);

  const lines = [];
  lines.push(cent(ticket.nombre || 'MI BAR'));
  lines.push(cent(ticket.fecha || ''));
  lines.push(cent('Mesa: ' + (ticket.mesa || '')));
  lines.push(sep);

  if (ticket.titulo) {
    lines.push(cent(ticket.titulo));
    lines.push(sep);
  }

  lines.push(pad('Articulo', 18) + rpad('Ud', 2) + ' ' + rpad('P.U.', 6) + ' ' + rpad('Total', 6));
  lines.push(sep);

  (ticket.lineas || []).forEach(l => {
    const nombre = String(l.nombre).substring(0, 18);
    const ud     = String(parseInt(l.cantidad));
    const pu     = parseFloat(l.precio).toFixed(2).replace('.', ',');
    const total  = parseFloat(l.subtotal).toFixed(2).replace('.', ',');
    lines.push(pad(nombre, 18) + rpad(ud, 2) + ' ' + rpad(pu, 6) + ' ' + rpad(total, 6));
  });

  lines.push(sep);
  lines.push(rpad('TOTAL: ' + parseFloat(ticket.total).toFixed(2).replace('.', ',') + ' EUR', W));
  lines.push('');
  lines.push(cent('Gracias por su visita!'));

  return lines.join('\n');
}

async function imprimirDirecto(html, callback, ticketData) {
  // Si no se pasan datos directos, extraer del DOM
  if (!ticketData) {
    ticketData = {
      nombre: localStorage.getItem('bar_nombre') || 'MI BAR',
      fecha:  '',
      mesa:   '',
      titulo: '',
      lineas: [],
      total:  0
    };
    const contenido = document.getElementById('ticketContenido');
    if (contenido) {
      const fechaEl = contenido.querySelector('.ticket-fecha');
      const mesaEl  = contenido.querySelector('.ticket-mesa');
      const tituloEl = contenido.querySelector('.ticket-titulo');
      const totalEl = contenido.querySelector('.ticket-total');
      if (fechaEl)  ticketData.fecha  = fechaEl.textContent.trim();
      if (mesaEl)   ticketData.mesa   = mesaEl.textContent.replace(/^Mesa:\s*/i, '').trim();
      if (tituloEl) ticketData.titulo = tituloEl.textContent.trim();
      if (totalEl)  ticketData.total  = totalEl.textContent.replace(/[^0-9.,]/g, '').trim();
      contenido.querySelectorAll('.ticket-tabla tbody tr').forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 4) {
          ticketData.lineas.push({
            nombre:   tds[0].textContent.trim(),
            cantidad: tds[1].textContent.trim(),
            precio:   tds[2].textContent.replace('€','').trim(),
            subtotal: tds[3].textContent.replace('€','').trim()
          });
        }
      });
    }
  }
  const ticketText = ticketToPlainText(ticketData);
  try {
    const resp = await fetch(`${PRINT_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ticketText })
    });
    const data = await resp.json();
    if (data.success) {
      if (callback) callback();
      return;
    }
  } catch (e) {
    console.warn('Print listener no disponible, usando impresion del navegador');
  }
  // Fallback: usar window.print() via iframe oculto
  imprimirEnIframe(html, callback);
}

function imprimirEnIframe(html, callback) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      if (callback) callback();
    }, 500);
  }, 300);
}

function getTicketStyles(anchoPapel) {
  return `@page { size: ${anchoPapel}mm auto; margin: 2mm 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: ${anchoPapel}mm; padding: 0; color: #000; background: #fff; }
.ticket-nombre-bar { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 2px; line-height: 1.2; }
.ticket-fecha, .ticket-mesa { text-align: center; font-size: 11px; color: #000; }
.ticket-sep { text-align: center; margin: 4px 0; color: #000; font-size: 11px; }
.ticket-tabla { width: 100%; border-collapse: collapse; margin: 4px 0; }
.ticket-tabla th { border-bottom: 1px solid #000; padding: 2px 2px; font-size: 10px; text-align: left; }
.ticket-tabla th:last-child { text-align: right; }
.ticket-tabla td { padding: 2px 2px; font-size: 11px; }
.ticket-tabla td:last-child { text-align: right; }
.ticket-total { font-size: 14px; font-weight: bold; text-align: right; margin-top: 4px; }
.ticket-gracias { text-align: center; margin-top: 8px; font-size: 10px; color: #000; }
@media print { body { width: ${anchoPapel}mm; } }`;
}

async function imprimirTicket(auto = false) {
  await ensurePrintListener();
  const contenido = document.getElementById('ticketContenido').innerHTML;
  const anchoPapel = 78;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getTicketStyles(anchoPapel)}</style></head><body>${contenido}</body></html>`;

  imprimirDirecto(html, auto ? () => setTimeout(() => procesarTicketQueue(), 300) : null);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function abrirModal(id){ document.getElementById(id)?.classList.add('open'); }
function cerrarModal(id){ document.getElementById(id)?.classList.remove('open'); }
function setLoader(v){ document.getElementById('loader')?.classList.toggle('active', v); }