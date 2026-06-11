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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const mesas = await API.getMesas();
    renderizarMesas(mesas);
    if (mesaActiva) {
      const mesa = mesas.find(m =>
        parseInt(m.MESA) === parseInt(mesaActiva)
      );
      if (mesa) {
        await entrarMesa(
          mesa.MESA,
          mesa.NOMBRE
        );
      } else {
        mostrarToast('Mesa no encontrada. Redirigiendo al inicio.', 'warning');
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

  const cobrable = mesas.filter(m => parseFloat(m.TOTAL_PTE) > 0);

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
  // Liberar la mesa y redirigir al index
  if (mesaActiva && !mesaCobrado) {
    try {
      await API.estadoMesa(mesaActiva, 'DISPONIBLE');
    } catch (err) {
      mostrarToast('No se pudo liberar la mesa: ' + err.message, 'error');
    }
  }
  window.location.href = 'index.html';
}

function renderizarCobro() {
  document.getElementById('cobroTotalPte').textContent =
    totalPte.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('resumenPte').textContent =
    totalPte.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('resumenSel').textContent = '0,00 €';

  document.getElementById('btnCobrarSel').disabled = true;

  const container = document.getElementById('cobroLineas');

  if (!lineasCobro.length) {
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

  document.getElementById('resumenSel').textContent =
    total.toFixed(2).replace('.', ',') + ' €';

  document.getElementById('btnCobrarSel').disabled = total === 0;
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
      // fallback to fetch
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
  try {
    const res = await API.cobrarMesa(mesaActiva, 
      accionPendiente === 'todo' ? [] : obtenerItemsSeleccionados(),
      accionPendiente === 'todo' ? 0 : obtenerTotalSeleccionado(),
      accionPendiente === 'todo'
    );

    ticketQueue = [];
    const mesaCobrada = res.mesa_cobrada === true;
    ticketReturnToMesas = mesaCobrada;
    ticketReturnToIndex = !mesaCobrada && accionPendiente !== 'todo';
    mesaCobrado = mesaCobrada;
    reloadAfterTickets = accionPendiente === 'todo';
    if (res.ticket) ticketQueue.push(res.ticket);
    if (res.ticket_completo) {
      ticketQueue.push(res.ticket_completo);
    }

    if (ticketQueue.length) {
      procesarTicketQueue();
    } else {
      if (reloadAfterTickets) {
        window.location.reload();
        return;
      }
      if (ticketReturnToIndex) {
        await liberarMesaCobro();
        window.location.href = 'index.html';
        return;
      }
      mostrarToast('Cobro registrado', 'success');
      if (mesaCobrada) {
        setTimeout(() => volverMesas(true), 1200);
      } else {
        await entrarMesa(mesaActiva, document.getElementById('cobroMesaNombre').textContent);
      }
    }
  } catch (err) { mostrarToast('Error: ' + err.message, 'error'); }
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

  return `
    <div class="ticket-wrap">
      <div class="ticket-nombre-bar">${escHtml(nombre)}</div>
      <div class="ticket-fecha">${ticket.fecha}</div>
      <div class="ticket-mesa">Mesa: ${escHtml(ticket.mesa)}</div>
      <div class="ticket-sep">────────────────────</div>
      <div class="ticket-titulo">${escHtml(ticket.titulo || 'Ticket')}</div>
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
      mesaCobrado = false;
      volverMesas(true);
    } else {
      entrarMesa(mesaActiva, document.getElementById('cobroMesaNombre').textContent);
    }
    return;
  }

  const ticket = ticketQueue.shift();
  mostrarTicket(ticket, true);
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
    mesaCobrado = false;
    volverMesas(true);
  } else {
    entrarMesa(mesaActiva, document.getElementById('cobroMesaNombre').textContent);
  }
}

function imprimirTicket(auto = false) {
  const contenido = document.getElementById('ticketContenido').innerHTML;
  const ventana   = window.open('', '_blank', 'width=400,height=600');
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
      setTimeout(() => procesarTicketQueue(), 500);
    }
  }, 300);
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