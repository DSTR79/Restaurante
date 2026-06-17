let mesaSeleccionadaId = null; 

const ADMIN_CIERRE_PASSWORD = '1234';
const ADMIN_CIERRE_EXPIRATION_MS = 10 * 60 * 1000;

const MINUTOS_OCULTAR_PAGADA = 1;

document.addEventListener('DOMContentLoaded', async () => {
  const headerNombre = document.getElementById('headerNombreDispositivo');
  if (headerNombre) headerNombre.textContent = 'Comprobando...';

  try {
    const nombre = await cargarNombreDispositivoPorIP();
    if (headerNombre) headerNombre.textContent = nombre;
  } catch (err) {
    mostrarBloqueoRegistroDispositivo(err);
    return;
  }

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

  // Forzar pantalla completa al interactuar y recordar preferencia
  document.addEventListener('click', () => {
    if (!document.fullscreenElement && !window.navigator.standalone) {
      document.documentElement.requestFullscreen()
        .then(() => {
          localStorage.setItem('fullscreen_preferred', 'true');
        })
        .catch(() => {});
    }
  });

  // Intentar restaurar si el usuario ya lo activó antes
  if (localStorage.getItem('fullscreen_preferred') === 'true' && !document.fullscreenElement) {
    // El navegador requiere un gesto, así que el primer click lo activará arriba
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

  const btnCierre = document.getElementById('btnCierre');
  if (btnCierre) btnCierre.addEventListener('click', abrirCierrePassword);

  document.getElementById('btnCancelarCierre').addEventListener('click', () => cerrarModal('modalCierrePassword'));
  document.getElementById('btnConfirmarCierre').addEventListener('click', confirmarCierrePassword);
  document.getElementById('inputCierrePassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarCierrePassword();
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
    console.log('result entrar:', result);
    window.location.href = `mesa.html?id=${mesaSeleccionadaId}&comanda=${result.comanda_id}`;
  } catch (err) {
    mostrarToast(err.message, 'error');
  } finally {
    setLoader(false);
  }
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

function mostrarBloqueoAcceso(mensaje) {
  const main = document.querySelector('main');
  const headerNombre = document.getElementById('headerNombreDispositivo');
  const acciones = document.querySelectorAll('button');

  if (headerNombre) headerNombre.textContent = 'IP no registrada';
  acciones.forEach(btn => {
    btn.disabled = true;
  });

  if (main) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <h3>Acceso denegado</h3>
        <p>${escHtml(mensaje || 'Esta IP no está registrada en la base de datos.')}</p>
      </div>`;
  }
}

function mostrarBloqueoRegistroDispositivo(error) {
  const main = document.querySelector('main');
  const headerNombre = document.getElementById('headerNombreDispositivo');
  const acciones = document.querySelectorAll('button');
  const mensaje = error?.message || 'Esta IP no esta registrada en la base de datos.';
  const ip = error?.data?.ip || 'No detectada';

  if (headerNombre) headerNombre.textContent = 'IP no registrada';
  acciones.forEach(btn => {
    btn.disabled = true;
  });

  if (main) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <h3>Acceso denegado</h3>
        <p>${escHtml(mensaje)}</p>
        <p><strong>IP detectada:</strong> ${escHtml(ip)}</p>
        <div class="form-group">
          <label for="inputRegistroNombre">Nombre de usuario</label>
          <input
            type="text"
            id="inputRegistroNombre"
            class="form-input"
            placeholder="Nombre del trabajador"
            maxlength="100"
            autocomplete="off"
          />
        </div>
        <div class="form-group">
          <label for="inputRegistroPassword">Contraseña de administrador</label>
          <input
            type="password"
            id="inputRegistroPassword"
            class="form-input"
            placeholder="Contraseña"
            autocomplete="current-password"
          />
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="btnRegistrarDispositivo">Registrar dispositivo</button>
        </div>
      </div>`;
  }

  const btnRegistrar = document.getElementById('btnRegistrarDispositivo');
  const inputNombre = document.getElementById('inputRegistroNombre');
  const inputPassword = document.getElementById('inputRegistroPassword');

  async function registrarDispositivoActual() {
    const nombre = inputNombre.value.trim();
    const password = inputPassword.value.trim();

    if (!nombre) {
      mostrarToast('Introduce un nombre de usuario.', 'warning');
      inputNombre.focus();
      return;
    }

    if (!password) {
      mostrarToast('Introduce la contraseña de administrador.', 'warning');
      inputPassword.focus();
      return;
    }

    btnRegistrar.disabled = true;
    setLoader(true);
    try {
      const result = await API.registrarDispositivo(nombre, password);
      mostrarToast(`Dispositivo registrado como "${result.nombre}"`, 'success');
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      mostrarToast(err.message, 'error');
      btnRegistrar.disabled = false;
    } finally {
      setLoader(false);
    }
  }

  if (btnRegistrar && inputNombre && inputPassword) {
    btnRegistrar.addEventListener('click', registrarDispositivoActual);
    inputNombre.addEventListener('keydown', e => {
      if (e.key === 'Enter') inputPassword.focus();
    });
    inputPassword.addEventListener('keydown', e => {
      if (e.key === 'Enter') registrarDispositivoActual();
    });
    inputNombre.focus();
  }
}
