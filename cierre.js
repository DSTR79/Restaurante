const cierreAccessToken = 'bar_cierre_access';
const cierreAccessExpiry = parseInt(localStorage.getItem(cierreAccessToken) || '0', 10);

document.addEventListener('DOMContentLoaded', async () => {
  if (!cierreAccessExpiry || Date.now() > cierreAccessExpiry) {
    window.location.href = 'index.html';
    return;
  }

  bindCierreEventos();
  await cargarCierre();
});

function bindCierreEventos() {
  document.getElementById('btnCancelarNuevoDia')?.addEventListener('click', () => cerrarModal('modalNuevoDia'));
  document.getElementById('btnConfirmarNuevoDia')?.addEventListener('click', confirmarCerrarDia);
}

async function cargarCierre() {
  setLoader(true);
  try {
    const data = await API.getCierreData();
    renderCierre(data);
  } catch (err) {
    mostrarToast('Error al cargar el cierre: ' + err.message, 'error');
  } finally {
    setLoader(false);
  }
}

function renderCierre(data) {
  const desde = data.desde_ultimo_cierre
    ? `Desde el último cierre: ${formatDate(data.desde_ultimo_cierre)}`
    : 'Sin cierre previo disponible.';

  document.getElementById('alertasContainer').innerHTML = `
    <div class="cierre-hero">
      <div class="cierre-hero-label">${escHtml(desde)}</div>
      <div class="cierre-hero-detail">Ventas registradas desde el último cierre hasta ahora.</div>
    </div>`;

  const seccionPagadas = document.getElementById('seccionPagadas');
  const listaPagadas = document.getElementById('listaMesasPagadas');
  listaPagadas.innerHTML = '';

  if (data.mesas_cobradas && data.mesas_cobradas.length) {
    seccionPagadas.style.display = 'block';
    data.mesas_cobradas.forEach(mesa => {
      listaPagadas.innerHTML += renderMesaCobrada(mesa);
    });
  } else {
    seccionPagadas.style.display = 'block';
    listaPagadas.innerHTML = `
      <div class="cierre-empty">
        <div class="cierre-empty-icon">✅</div>
        <p>No hay mesas cerradas desde el último cierre.</p>
      </div>`;
  }

  const seccionPendientes = document.getElementById('seccionPendientes');
  const listaPendientes = document.getElementById('listaMesasPendientes');
  listaPendientes.innerHTML = '';

  if (data.pendientes && data.pendientes.length) {
    seccionPendientes.style.display = 'block';
    data.pendientes.forEach(mesa => {
      listaPendientes.innerHTML += `
        <div class="cierre-pendiente-row">
          <div><strong>${escHtml(mesa.nombre)}</strong> (Mesa ${mesa.mesa})</div>
          <div>${formatMoney(mesa.total_pendiente)}</div>
        </div>`;
    });
  } else {
    seccionPendientes.style.display = 'none';
  }

  document.getElementById('totalDiaAmount').textContent = formatMoney(data.total_dia);
  document.getElementById('totalFinalDetalle').textContent = data.total_dia > 0
    ? `Mesas cobradas: ${data.mesas_cobradas.length}`
    : 'No hay ventas registradas en este período.';

  const actions = document.getElementById('cierreActions');
  actions.innerHTML = `
    <button class="btn btn-danger btn-lg" id="btnCerrarDia" ${data.mesas_cobradas.length === 0 ? 'disabled' : ''}>
      🗂️ Cerrar día y archivar ventas
    </button>`;

  document.getElementById('btnCerrarDia')?.addEventListener('click', () => abrirModal('modalNuevoDia'));
}

function renderMesaCobrada(mesa) {
  const lineas = mesa.lineas.map(linea => `
      <tr>
        <td>${escHtml(linea.nombre)}</td>
        <td style="text-align:center">${linea.cantidad}</td>
        <td style="text-align:right">${formatMoney(linea.precio)}</td>
        <td style="text-align:right">${formatMoney(linea.subtotal)}</td>
      </tr>
    `).join('');

  return `
    <div class="cierre-mesa-card">
      <div class="cierre-mesa-header">
        <div>
          <div class="cierre-mesa-title">Mesa ${mesa.mesa} · ${escHtml(mesa.nombre)}</div>
          <div class="cierre-mesa-subtitle">Total facturado: ${formatMoney(mesa.total)}</div>
        </div>
      </div>
      <div class="cierre-mesa-lineas">
        <table class="cierre-table">
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Ud.</th>
              <th>Precio U.</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${lineas}</tbody>
        </table>
      </div>
    </div>`;
}

async function confirmarCerrarDia() {
  cerrarModal('modalNuevoDia');
  setLoader(true);
  try {
    const res = await API.cerrarDia();
    mostrarToast(`Cierre realizado. Total archivado: ${formatMoney(res.total)}`, 'success');
    localStorage.removeItem(cierreAccessToken);
    setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    mostrarToast('No se pudo cerrar el día: ' + err.message, 'error');
  } finally {
    setLoader(false);
  }
}

function formatMoney(value) {
  return parseFloat(value || 0).toFixed(2).replace('.', ',') + ' €';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
