// ============================================================
// CONFIGURACION GLOBAL DEL BAR
// ============================================================
let CONFIG = {
  bar: {
    nombre: 'Mi Bar',
    direccion: '',
    telefono: '',
    logo_url: ''
  },
  printers: {}
};

async function cargarConfig() {
  try {
    const res = await fetch('config.json');
    CONFIG = await res.json();
    
    // Esperar a que DOM esté listo
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        actualizarDOMConfig();
      });
    } else {
      actualizarDOMConfig();
    }
    
    console.log('✓ Config cargada:', CONFIG.bar.nombre);
  } catch (err) {
    console.error('Error cargando config.json:', err);
  }
}

function actualizarDOMConfig() {
  // Actualizar título de página
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    pageTitle.textContent = CONFIG.bar.nombre + ' - Gestion de Mesas';
  }
  
  // Actualizar nombre en header
  const barName = document.getElementById('barName');
  if (barName) {
    barName.textContent = CONFIG.bar.nombre;
  }
}


// Cargar config al iniciar (inmediatamente)
cargarConfig();

const API = {
  base: '',

  async _fetch(url, options = {}) {
    const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      if (!res.ok) {
        const error = new Error(data.error || 'Error desconocido');
        error.data = data;
        throw error;
      }
      return data;
    } catch (err) {
      console.error('Respuesta inválida:', text);
      if (err instanceof SyntaxError) throw new Error('Error del servidor. Revisa la consola.');
      throw err;
    }
  },

  post(url, body) {
    return this._fetch(`${this.base}${url}`, { method: 'POST', body: JSON.stringify(body) });
  },

  getProductos()    { return this._fetch(`${this.base}api/productos.php`); },
  getCategorias()   { return this._fetch(`${this.base}api/categorias.php`); },
  getMesas() { return this._fetch(`${this.base}api/mesas_resumen.php`); },
  getDetalleMesa(id){ return this._fetch(`${this.base}api/mesas.php?action=detalle&id=${id}`); },
  getLineasCobro(id){ return this._fetch(`${this.base}api/mesas.php?action=lineas_cobro&id=${id}`); },
  getMesasDisponiblesConLineas(mesaActiva) { 
    const url = `${this.base}api/mesas.php?action=mesas_disponibles_con_lineas${mesaActiva ? '&mesa_activa=' + mesaActiva : ''}`;
    return this._fetch(url); 
  },
  getCierreData() { return this._fetch(`${this.base}api/cierre.php?action=datos`); },
  getDispositivo() { return this._fetch(`${this.base}api/dispositivo.php`); },
  registrarDispositivo(nombre, password) { return this.post('api/dispositivo.php', { nombre, password }); },
  cerrarDia() { return this.post('api/cierre.php?action=cerrar', {}); },

  crearMesa(nombre) { return this.post('api/mesas.php?action=crear', { nombre }); },
  entrarMesa(id)    { return this.post('api/mesas.php?action=entrar', { id }); },
  guardarYSalir(id, comanda)         { return this.post('api/mesas.php?action=guardar', { id, comanda }); },
  borrarLineasCanceladas(id, comanda){ return this.post('api/mesas.php?action=salir', { id, comanda }); },
  actualizarLinea(id, producto_id, cantidad, comanda_id) {
    return this.post('api/mesas.php?action=linea', { id, producto_id, cantidad, comanda_id });
  },
  cobrarMesa(id, items, total, todo, factura = false, metodo_pago = 'efectivo', dispositivo = 'Sin nombre') {
    return this.post('api/mesas.php?action=cobrar', { id, items, total, todo, factura, metodo_pago, dispositivo });
  },
  estadoMesa(id, estado) {
    return this.post('api/mesas.php?action=estado', { id, estado });
  },
  agregarComentario(linea_id, comentario, mesa_id, comanda_id) {
    return this.post('api/mesas.php?action=comentario', { linea_id, comentario, mesa_id, comanda_id });
  },
  actualizarLineaPorId(linea_id, cantidad, mesa_id, comanda_id) {
    return this.post('api/mesas.php?action=linea_id', { linea_id, cantidad, mesa_id, comanda_id });
  },
  repetirLinea(producto_id, texto, mesa_id, comanda_id) {
    return this.post('api/mesas.php?action=repetir', { producto_id, texto, mesa_id, comanda_id });
  },
};

let nombreDispositivoActual = null;

function obtenerNombreDispositivo() {
  return nombreDispositivoActual;
}

async function cargarNombreDispositivoPorIP() {
  let data;
  try {
    data = await API.getDispositivo();
  } catch (err) {
    throw err;
  }
  const nombre = (data.nombre || '').trim();

  if (!data.autorizado || !nombre || nombre === 'Sin identificar') {
    throw new Error(data.error || 'Esta IP no está registrada.');
  }

  nombreDispositivoActual = nombre;
  return nombre;
}

function iniciarReloj(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  function tick() {
    const now = new Date();
    const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const dia  = dias[now.getDay()];
    const fecha = now.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });
    const hora  = now.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    el.textContent = `${dia}  ${fecha}  ·  ${hora}`;
  }
  tick();
  setInterval(tick, 1000);
}
// --- Impresora POS-80C ---
let printListenerOK = null;

async function checkPrintListener() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch('api/print.php?action=ping', { signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) { printListenerOK = true; return true; }
  } catch (e) { /* offline */ }
  printListenerOK = false;
  return false;
}

// Print listener ya no necesario (impresora en red IP)
async function ensurePrintListener() {
  return true;
}

function mostrarToast(msg, tipo = 'info', duracion = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `<span>${icons[tipo] || ''}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duracion);
}

function setLoader(visible) {
  const el = document.getElementById('loader');
  if (el) el.classList.toggle('active', visible);
}

function abrirModal(id)  { document.getElementById(id)?.classList.add('open'); }
function cerrarModal(id) { document.getElementById(id)?.classList.remove('open'); }

document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

iniciarReloj('reloj');
