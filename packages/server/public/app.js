const token = localStorage.getItem('token');
const role = localStorage.getItem('role');

if (!token){
    window.location.href = '/login.html';
}


const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;
    
    return originalFetch(url, options).then(res => {
        if (res.status === 401) {
            alert("Session expired. Please log in again.");
            logout();
        }
        return res;
    });
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Dashboard Started');
    if (role !== 'admin') {
        const buttonsAdmin = document.querySelectorAll('.btn-success, .btn-danger, .btn-info, .border-danger');
        buttonsAdmin.forEach(btn => {
            btn.style.display = 'none';
        });
        
        const dangerZone = document.querySelector('.border-danger');
        if(dangerZone) dangerZone.parentElement.parentElement.style.display = 'none';
    }
    
    const header = document.querySelector('.text-center p');
    if(header) header.innerHTML += `<br><span class="badge bg-info text-dark">👤 ${localStorage.getItem('username')} (${role.toUpperCase()})</span> <a href="#" onclick="logout()" class="text-danger ms-2">Logout</a>`;
    loadDrones();

    const btn = document.getElementById('btnSearch');
    if (btn) {
        btn.addEventListener('click', searchHistory);
    }
});

function logout() {
    localStorage.clear();
    window.location.href = '/login.html';
}

async function createUser() {
    const username = document.getElementById('newUser').value;
    const password = document.getElementById('newPass').value;
    const role = document.getElementById('newRole').value;

    if (!username || !password) {
        alert("Please enter your username and password.");
        return;
    }

    const btn = document.querySelector('#userModel .btn-info');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Creating...";
    btn.disabled = true;

    try {
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: username, 
                password: password, 
                role: role 
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert(`✅ Success! User "${username}" successfully created with role ${role.toUpperCase()}.`);
            
            document.getElementById('newUser').value = '';
            document.getElementById('newPass').value = '';
            const modalEl = document.getElementById('userModel');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
        } else {
            alert(`❌ Error: ${data.error}`);
        }

    } catch (error) {
        console.error(error);
        alert("❌ Connection error with the server.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}


async function loadDrones() {
    const selector = document.getElementById('didSelect');
    
    try {
        const response = await fetch('/drones');
        
        if (!response.ok) throw new Error("Error connecting to Drones API");
        
        const drones = await response.json();
        
        selector.innerHTML = '<option value="" selected disabled>-- Select a Drone --</option>';

        if (!drones || drones.length === 0) {
            selector.innerHTML += '<option disabled>⚠️ No drones registered</option>';
            return;
        }

        drones.forEach(dron => {
            const option = document.createElement('option');
            option.value = dron.droneDid; 

            if (dron.name.includes('Unregistered')) {
                option.text = `⚠️ ${dron.name} - ${dron.droneDid.substring(0, 15)}...`;
                option.style.color = 'red'; 
            } else {
                option.text = `✅ ${dron.name} (${dron.droneDid.substring(0, 10)}...)`;
            }
            
            selector.appendChild(option);
        });

    } catch (error) {
        console.error("Error loading drones:", error);
        selector.innerHTML = '<option disabled>❌ Error connecting to Blockchain</option>';
    }
}


async function searchHistory() {
    const selector = document.getElementById('didSelect');
    const did = selector.value;
    
    if (!did) {
        alert("⚠️ Please select a drone from the list first.");
        return;
    }

    const didEncoded = encodeURIComponent(did);
    
    const resultSection = document.getElementById('resultSection');
    const tbody = document.getElementById('bodyTable');
    
    resultSection.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" class="text-center p-5"><div class="spinner-border text-primary mb-2" role="status"></div><br>Decrypting Ledger data...</td></tr>';

    try {
        const response = await fetch(`/history/${didEncoded}`);
        
        if (!response.ok) throw new Error("Error fetching history data from server");
        
        const datos = await response.json();
        renderTable(datos);

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger fw-bold p-4">❌ Error retrieving data. Verify that the server is connected to Fabric.</td></tr>';
    }
}


function renderTable(data) {
    const tbody = document.getElementById('bodyTable');
    tbody.innerHTML = ''; 

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-muted">⚠️ There are no flight records for this criterion.</td></tr>';
        return;
    }

    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    data.forEach(data => {
        const altitude = data.altitude ? parseFloat(data.altitude).toFixed(2) : "0.00";
        const temp = data.temperature ? parseFloat(data.temperature).toFixed(1) : "0.0";
        const battery = data.battery || 0;
        
        const didShort = data.droneDid ? data.droneDid.substring(8, 20) + '...' : 'Uknown';
        
        const txId = data.txId || 'N/A';
        const txIdShort = txId.substring(0, 10) + '...';

        const fila = `
            <tr>
                <td>${new Date(data.timestamp).toLocaleString()}</td>
                <td class="fw-bold text-primary">${altitude} m</td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="progress flex-grow-1" style="height: 10px;">
                            <div class="progress-bar ${getBatteryColor(battery)}" role="progressbar" style="width: ${battery}%"></div>
                        </div>
                        <span class="ms-2 small">${battery}%</span>
                    </div>
                </td>
                <td>${temp} ºC</td>
                
                <td><code class="text-secondary" title="${data.droneDid}">${didShort}</code></td>
                
                <td>
                    <a href="#" class="badge bg-dark text-decoration-none font-monospace" title="Huella completa: ${txId}">
                        🔗 ${txIdShort}
                    </a>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

async function registerDrone() {
    const name = document.getElementById('regName').value;
    const did = document.getElementById('regDid').value;

    if (!name || !did) {
        alert("Please fill in all fields.");
        return;
    }

    const btn = document.querySelector('#registerModal .btn-success');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Writing in Ledger...";
    btn.disabled = true;

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ droneDid: did, name: name })
        });

        if (!response.ok) throw new Error("Error in server response");

        alert(`✅ Success! The drone "${name}" has been registered on the Blockchain.`);
        
        location.reload();

    } catch (error) {
        console.error(error);
        alert("❌ Error registering drone. Check the console.");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function revokeLicense() {
    const id = document.getElementById('revokeInput').value;
    if(!id) return alert("Please enter a credential ID");
    
    if(!confirm("Are you sure you want to revoke this license? It is irreversible.")) return;

    await fetch('/revoke', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ credentialId: id })
    });
    alert("License revoked. The drone can no longer fly.");
}

async function loadRevocations() {
    const tbody = document.getElementById('tableRevocations');
    tbody.innerHTML = '<tr><td colspan="3" class="text-center">⏳ Loading Ledger data...</td></tr>';

    try {
        const response = await fetch('/revocations');
        const list = await response.json();

        tbody.innerHTML = ''; 

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-success">✅ There are no active revoked licenses.</td></tr>';
            return;
        }

        list.sort((a, b) => new Date(b.revokedAt) - new Date(a.revokedAt));

        list.forEach(item => {
            const date = new Date(item.revokedAt).toLocaleString();
            const row = `
                <tr>
                    <td>${date}</td>
                    <td><code class="text-danger">${item.credentialId}</code></td>
                    <td>${item.reason || 'No specified'}</td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">❌ Error connecting with server.</td></tr>';
    }
}

function getBatteryColor(level) {
    if (level > 60) return 'bg-success';
    if (level > 20) return 'bg-warning';
    return 'bg-danger';
}