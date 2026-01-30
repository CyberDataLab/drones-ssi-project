import { createSSIAgent } from '@tfm/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Aceptar certificados autofirmados (solo para desarrollo)

async function main() {
  console.log('🚁 Iniciando Agente Dron (Modo Autónomo)...')

  const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'
  const DB_FILE = 'drone-database.sqlite'
  const CONFIG_FILE = path.join(__dirname, '../drone-config.json')

  // 1. CARGAR CONFIGURACIÓN
  if (!fs.existsSync(CONFIG_FILE)) {
      console.error('❌ ERROR FATAL: Archivo de configuración no encontrado.')
      console.error('👉 Ejecuta primero: npx ts-node src/setup.ts')
      process.exit(1)
  }
  
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  const SERVER_DID = config.serverDid

  try {
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY)
    
    // 2. VERIFICACIÓN DE IDENTIDAD (Estricta)
    // Ya no creamos identidad aquí. Asumimos que setup.ts hizo su trabajo.
    const identifiers = await agent.didManagerFind()
    
    if (identifiers.length === 0) {
        console.error('⛔ ERROR CRÍTICO: El dron no tiene identidad digital.')
        console.error('   La base de datos parece estar corrupta o no inicializada.')
        console.error('👉 Solución: Ejecuta "npm run setup" para reaprovisionar.')
        process.exit(1)
    }

    const droneDID = identifiers[0].did
    console.log(`✅ Identidad Verificada: ${droneDID}`)
    console.log(`📡 Servidor Destino: ${SERVER_DID}`)

    // 3. BUSCAR LICENCIA
    const credentials = await agent.dataStoreORMGetVerifiableCredentials()
    const license = credentials.find((c: any) => c.verifiableCredential.credentialSubject.type === 'DroneLicense')

    if (!license) {
        console.error('⛔ ALERTA DE SEGURIDAD: Dron sin licencia de vuelo válida.')
        console.error('   El sistema no permitirá el despegue telemétrico.')
        return
    }

    // 4. VOLAR (Enviar datos)
    const metricsData = {
      id: 'msg-' + Date.now(),
      type: 'metrics-update',
      body: {
        battery: 98,
        altitude: 25.5,
        temperature: 19,
        timestamp: new Date().toISOString(),
        verifiableCredential: [ license.verifiableCredential.proof.jwt ]
      },
      from: droneDID,
      to: [SERVER_DID],
    }

    console.log('📤 Enviando telemetría firmada...')
    
    const packedMessage = await agent.packDIDCommMessage({
      packing: 'authcrypt',
      message: metricsData,
    })

    const messageToSend = typeof packedMessage.message === 'string' 
        ? packedMessage.message 
        : JSON.stringify(packedMessage.message)

    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Aceptar certificados autofirmados (solo para desarrollo)
    });

    console.log('🔐 Usando canal seguro HTTPS con el servidor.')

    const response = await fetch('https://localhost:3000/messaging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: messageToSend,
      agent: httpsAgent
    } as any)

    if (response.ok) {
      console.log('✅ ¡ÉXITO! Telemetría aceptada y registrada por el servidor.')
    } else {
      console.error('❌ Error enviando datos:', response.statusText)
    }

  } catch (error) {
    console.error('❌ Error Operativo:', error)
  }
}

main()