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
    console.log('API call:', url);
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
  cobrarMesa(id, items, total, todo) {
    return this.post('api/mesas.php?action=cobrar', { id, items, total, todo });
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
