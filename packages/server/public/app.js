// Esperamos a que el HTML cargue completamente
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Dashboard Iniciado');

    // 1. CARGA AUTOMÁTICA: Llenar el desplegable consultando al servidor
    cargarFlotaDrones();

    // 2. EVENTOS: Vincular botón de búsqueda
    const btn = document.getElementById('btnBuscar');
    if (btn) {
        btn.addEventListener('click', buscarHistorial);
    }
});

/**
 * Consulta el endpoint /drones y rellena el <select>
 */
async function cargarFlotaDrones() {
    const selector = document.getElementById('didSelect');
    
    try {
        const response = await fetch('/drones');
        
        if (!response.ok) throw new Error("Error conectando con API de Drones");
        
        const drones = await response.json();
        
        // Limpiamos el estado de "Cargando..."
        selector.innerHTML = '<option value="" selected disabled>-- Selecciona un Dron --</option>';

        if (!drones || drones.length === 0) {
            selector.innerHTML += '<option disabled>⚠️ No se encontraron drones registrados</option>';
            return;
        }

        // Rellenamos el desplegable
        drones.forEach(dron => {
            const opcion = document.createElement('option');
            opcion.value = dron.droneDid; // El valor oculto es el DID
            // El texto visible es el Nombre Amigable + trozo del DID
            opcion.text = `${dron.name} (${dron.droneDid.substring(8, 20)}...)`;
            selector.appendChild(opcion);
        });

    } catch (error) {
        console.error("Error cargando drones:", error);
        selector.innerHTML = '<option disabled>❌ Error de conexión con Blockchain</option>';
    }
}

/**
 * Busca la telemetría del dron seleccionado
 */
async function buscarHistorial() {
    const selector = document.getElementById('didSelect');
    const did = selector.value; // Obtenemos el DID de la opción seleccionada
    
    if (!did) {
        alert("⚠️ Por favor, selecciona un dron de la lista primero.");
        return;
    }

    // Codificamos el DID por seguridad para la URL
    const didEncoded = encodeURIComponent(did);
    
    // UI: Mostrar estado de carga
    const resultSection = document.getElementById('resultSection');
    const tbody = document.getElementById('tablaCuerpo');
    
    resultSection.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" class="text-center p-5"><div class="spinner-border text-primary mb-2" role="status"></div><br>Descifrando datos del Ledger...</td></tr>';

    try {
        const response = await fetch(`/history/${didEncoded}`);
        
        if (!response.ok) throw new Error("Error obteniendo historial");
        
        const datos = await response.json();
        renderizarTabla(datos);

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger fw-bold p-4">❌ Error recuperando datos. Verifica que el servidor está conectado a Fabric.</td></tr>';
    }
}

/**
 * Pinta la tabla de resultados
 */
function renderizarTabla(datos) {
    const tbody = document.getElementById('tablaCuerpo');
    tbody.innerHTML = ''; 

    if (!datos || datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-muted">⚠️ No hay registros de vuelo para este criterio.</td></tr>';
        return;
    }

    // Ordenar: más reciente primero
    datos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    datos.forEach(dato => {
        const altitud = dato.altitude ? parseFloat(dato.altitude).toFixed(2) : "0.00";
        const temp = dato.temperature ? parseFloat(dato.temperature).toFixed(1) : "0.0";
        const bateria = dato.battery || 0;
        
        // DID corto para que no ocupe mucho
        const didCorto = dato.droneDid ? dato.droneDid.substring(8, 20) + '...' : 'Desconocido';
        
        // TxID (Huella Blockchain)
        const txId = dato.txId || 'N/A';
        const txIdCorto = txId.substring(0, 10) + '...';

        const fila = `
            <tr>
                <td>${new Date(dato.timestamp).toLocaleString()}</td>
                <td class="fw-bold text-primary">${altitud} m</td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="progress flex-grow-1" style="height: 10px;">
                            <div class="progress-bar ${getBatteryColor(bateria)}" role="progressbar" style="width: ${bateria}%"></div>
                        </div>
                        <span class="ms-2 small">${bateria}%</span>
                    </div>
                </td>
                <td>${temp} ºC</td>
                
                <td><code class="text-secondary" title="${dato.droneDid}">${didCorto}</code></td>
                
                <td>
                    <a href="#" class="badge bg-dark text-decoration-none font-monospace" title="Huella completa: ${txId}">
                        🔗 ${txIdCorto}
                    </a>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

function getBatteryColor(level) {
    if (level > 60) return 'bg-success';
    if (level > 20) return 'bg-warning';
    return 'bg-danger';
}