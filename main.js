let mesaSeleccionadaId = null; 

const ADMIN_CIERRE_PASSWORD = '1234';
const ADMIN_CIERRE_EXPIRATION_MS = 10 * 60 * 1000;

const MINUTOS_OCULTAR_PAGADA = 1;

document.addEventListener('DOMContentLoaded', () => {

  if (typeof cargarMesas === 'function') {
    cargarMesas();
    setInterval(cargarMesas, 8000);
  }

  if (typeof bindEventos === 'function') {
    bindEventos();
  }

  const mesasGrid = document.getElementById('mesasGrid');
  if (mesasGrid) {
    mesasGrid.addEventListener('click', handleMesaGridClick);
  }

  const headerNombre = document.getElementById('headerNombreDispositivo');
  if (headerNombre) {
    headerNombre.textContent = obtenerNombreDispositivo() || 'Sin nombre';
    cargarNombreDispositivoPorIP()
      .then(nombre => {
        headerNombre.textContent = nombre || 'Sin nombre';
      })
      .catch(err => {
        console.warn('No se pudo cargar el dispositivo por IP:', err);
      });
  }

  const botonCierre = document.getElementById('btnCierre');
  if (botonCierre) {
    botonCierre.addEventListener('click', abrirCierrePassword);
  }

});


async function cargarMesas() {
  try {
    const mesas = await API.getMesas();
    renderizarMesas(mesas);
  } catch (err) {
    mostrarToast('Error al cargar las mesas: ' + err.message, 'error');
  }
}

function renderizarMesas(mesas) {
  const grid = document.getElementById('mesasGrid');
  const mesasVisibles = mesas.filter(mesa => mesa.ESTADO !== 'COBRADA');

  if (mesasVisibles.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍽️</div>
        <h3>Sin mesas activas</h3>
        <p>Pulsa <strong>Nueva Mesa</strong> para crear la primera mesa del día.</p>
      </div>`;
    return;
  }

  grid.innerHTML = mesasVisibles.map(MESAS => {
    const claseMapa = {
      'DISPONIBLE': 'disponible',
      'OCUPADA':    'bloqueada',
      'COBRADA':    'pagada',
    };
    const claseCSS = claseMapa[MESAS.ESTADO] || 'disponible';

    const estadoLabel = {
      'DISPONIBLE': '🟡 Disponible',
      'OCUPADA':    '🔴 Ocupada',
      'COBRADA':    '✅ Cobrada',
    }[MESAS.ESTADO] || MESAS.ESTADO;

    const infoHtml = MESAS.ESTADO === 'OCUPADA'
      ? `<div class="camarero"><span>👤</span>${escHtml(MESAS.ABIERTO_POR)}</div>`
      : '';

    const totalFormateado = parseFloat(MESAS.TOTAL || 0).toFixed(2).replace('.', ',');
    const numItems = parseInt(MESAS.NUM_ARTICULOS || MESAS.NUM_LINEAS || 0);

    return `
      <div class="mesa-card ${claseCSS}" data-id="${MESAS.MESA}" data-estado="${MESAS.ESTADO}">
        <div class="mesa-card-header">
          <div class="mesa-nombre">${escHtml(MESAS.NOMBRE)}</div>
          <span class="badge badge-${claseCSS}">${estadoLabel}</span>
        </div>
        ${infoHtml ? `<div class="mesa-info">${infoHtml}</div>` : ''}
        <div class="mesa-card-meta">
          <div class="mesa-total">${totalFormateado} €</div>
          <div class="mesa-items">${numItems} artículos</div>
        </div>
      </div>`;
  }).join('');
}

function handleMesaGridClick(event) {
  const card = event.target.closest('.mesa-card');
  if (!card) return;

  const estado = card.dataset.estado;
  if (estado === 'OCUPADA') {
    mostrarToast('Esta mesa ya está ocupada, no puedes entrar ahora.', 'warning');
    return;
  }

  const mesaId = card.dataset.id;
  if (!mesaId) return;

  mesaSeleccionadaId = mesaId;
  confirmarEntrarMesa();
}

function formatNumber(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}

function formatCurrency(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

function clicMesa(mesaId, estado) {
  if (estado === 'OCUPADA') {
    mostrarToast('Esta mesa está siendo atendida ahora mismo.', 'warning');
    return;
  }
  if (estado === 'COBRADA') {
    mostrarToast('Esta mesa ya está cobrada.', 'info');
    return;
  }
  mesaSeleccionadaId = mesaId;
  confirmarEntrarMesa();
}

function bindEventos() {
 document.getElementById('btnNuevaMesa').addEventListener('click', () => {
    document.getElementById('inputNombreMesa').value = '';
    abrirModal('modalCrearMesa');
    setTimeout(() => document.getElementById('inputNombreMesa').focus(), 50);
  });

  document.getElementById('btnCancelarCrear').addEventListener('click', () => {
    cerrarModal('modalCrearMesa');
  });

  document.getElementById('btnConfirmarCrear').addEventListener('click', crearNuevaMesa);
  document.getElementById('inputNombreMesa').addEventListener('keydown', e => {
    if (e.key === 'Enter') crearNuevaMesa();
  });

  const btnNuevaMesaRapida = document.getElementById('btnNuevaMesaRapida');
  if (btnNuevaMesaRapida) {
    btnNuevaMesaRapida.addEventListener('click', crearNuevaMesaRapida);
  }

  document.getElementById('btnConfirmarDispositivo').addEventListener('click', confirmarNombreDispositivo);
  document.getElementById('inputNombreDispositivo').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarNombreDispositivo();
  });

  const btnCierre = document.getElementById('btnCierre');
  if (btnCierre) btnCierre.addEventListener('click', abrirCierrePassword);

  document.getElementById('btnCancelarCierre').addEventListener('click', () => cerrarModal('modalCierrePassword'));
  document.getElementById('btnConfirmarCierre').addEventListener('click', confirmarCierrePassword);
  document.getElementById('inputCierrePassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarCierrePassword();
  });

  document.getElementById('btnCambiarDispositivo').addEventListener('click', () => {
    const actual = localStorage.getItem('bar_nombre_dispositivo') || '';
    document.getElementById('inputNombreDispositivo').value = actual;
    abrirModal('modalNombreDispositivo');
    setTimeout(() => document.getElementById('inputNombreDispositivo').focus(), 50);
  });

}

async function crearNuevaMesa() {
  const nombre = document.getElementById('inputNombreMesa').value.trim() || 'Mesa sin nombre';
  try {
    const data = await API.crearMesa(nombre);
    window.location.href = `mesa.html?id=${data.mesa}&comanda=${data.comanda_id}`;
  } catch (err) {
    mostrarToast(err.message, 'error');
  }
}

async function crearNuevaMesaRapida() {
  try {
    const data = await API.crearMesa('Mesa rápida');
    window.location.href = `mesa.html?id=${data.mesa}&comanda=${data.comanda_id}&quick=1`;
  } catch (err) {
    mostrarToast(err.message, 'error');
  }
}

async function confirmarEntrarMesa() {
  if (!mesaSeleccionadaId) return;
  setLoader(true);
  try {
    const result = await API.entrarMesa(mesaSeleccionadaId);
    console.log('result entrar:', result); // ← añade esto
    window.location.href = `mesa.html?id=${mesaSeleccionadaId}&comanda=${result.comanda_id}`;
  } catch (err) {
    mostrarToast(err.message, 'error');
  } finally {
    setLoader(false);
  }
}

function confirmarNombreDispositivo() {
  const nombre = document.getElementById('inputNombreDispositivo').value.trim();
  if (!nombre) {
    mostrarToast('Introduce un nombre para este dispositivo.', 'warning');
    document.getElementById('inputNombreDispositivo').focus();
    return;
  }
  localStorage.setItem('bar_nombre_dispositivo', nombre);
  const headerNombre = document.getElementById('headerNombreDispositivo');
  if (headerNombre) headerNombre.textContent = nombre;
  cerrarModal('modalNombreDispositivo');
  mostrarToast(`Dispositivo guardado como "${nombre}"`, 'success');
}

function abrirCierrePassword() {
  document.getElementById('inputCierrePassword').value = '';
  abrirModal('modalCierrePassword');
  setTimeout(() => document.getElementById('inputCierrePassword').focus(), 50);
}

function confirmarCierrePassword() {
  const password = document.getElementById('inputCierrePassword').value.trim();
  if (password !== ADMIN_CIERRE_PASSWORD) {
    mostrarToast('Contraseña incorrecta', 'error');
    return;
  }
  localStorage.setItem('bar_cierre_access', String(Date.now() + ADMIN_CIERRE_EXPIRATION_MS));
  cerrarModal('modalCierrePassword');
  window.open('cierre.html', '_blank', 'noopener');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
