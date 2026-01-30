// Esperamos a que el HTML cargue completamente antes de ejecutar nada
document.addEventListener('DOMContentLoaded', () => {
    // Vinculamos el botón con la función
    const btn = document.getElementById('btnBuscar');
    if (btn) {
        btn.addEventListener('click', buscarHistorial);
    }
});

async function buscarHistorial() {
    const input = document.getElementById('didInput');
    const did = input.value.trim();
    
    if (!did) {
        alert("Por favor, introduce un DID válido.");
        return;
    }

    // Codificamos el DID para la URL
    const didEncoded = encodeURIComponent(did);
    
    // Mostramos estado de carga (opcional, pero queda pro)
    const tbody = document.getElementById('tablaCuerpo');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">⏳ Cargando datos de la Blockchain...</td></tr>';
    document.getElementById('resultSection').style.display = 'block';

    try {
        const response = await fetch(`/history/${didEncoded}`);
        
        if (!response.ok) throw new Error("Error conectando con el servidor");
        
        const datos = await response.json();
        renderizarTabla(datos);

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">❌ Error obteniendo datos. Revisa la consola.</td></tr>';
    }
}

function renderizarTabla(datos) {
    const tbody = document.getElementById('tablaCuerpo');
    tbody.innerHTML = ''; // Limpiar mensaje de carga

    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">⚠️ No se encontraron vuelos para este Dron.</td></tr>';
        return;
    }

    // Ordenar: más reciente arriba
    datos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    datos.forEach(dato => {
        const fila = `
            <tr>
                <td>${new Date(dato.timestamp).toLocaleString()}</td>
                <td class="fw-bold text-primary">${dato.altitude} m</td>
                <td>
                    <div class="progress" style="height: 20px;">
                        <div class="progress-bar ${getBatteryColor(dato.battery)}" role="progressbar" style="width: ${dato.battery}%">${dato.battery}%</div>
                    </div>
                </td>
                <td>${dato.temperature} ºC</td>
                <td><small class="text-muted font-monospace">${dato.txId.substring(0, 15)}...</small></td>
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