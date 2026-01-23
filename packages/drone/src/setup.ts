import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'

const CONFIG_FILE = path.join(__dirname, '../drone-config.json')
const DB_FILE = 'drone-database.sqlite'
const SECRET_KEY = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'

function preguntar(pregunta: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close()
      resolve(respuesta.trim())
    })
  })
}

async function main() {
  console.log('🛠️  INICIANDO CONFIGURACIÓN INICIAL DEL DRON')
  console.log('==========================================')

  try {
    // 1. ARRANCAMOS EL AGENTE (Esto crea la base de datos si no existe)
    console.log('⚙️  Inicializando sistema criptográfico...')
    const agent = await createSSIAgent(DB_FILE, SECRET_KEY)

    // 2. OBTENER O CREAR IDENTIDAD (DID) AUTOMÁTICAMENTE
    const identifiers = await agent.didManagerFind()
    let droneDID: string

    if (identifiers.length === 0) {
        console.log('✨ Generando nueva Identidad Digital (DID)...')
        const newId = await agent.didManagerCreate({ alias: 'Dron-01', provider: 'did:key' })
        droneDID = newId.did
    } else {
        droneDID = identifiers[0].did
        console.log('ℹ️  Identidad existente detectada.')
    }

    // 3. MOSTRAR DID Y ESPERAR AL USUARIO
    console.log('\n-------------------------------------------------------------')
    console.log('🤖 IDENTIDAD DEL DRON:')
    console.log(`👉 ${droneDID}`)
    console.log('-------------------------------------------------------------')
    console.log('📋 INSTRUCCIONES:')
    console.log('1. Copia el DID de arriba.')
    console.log('2. Ve a la terminal de la AUTORIDAD y genera una licencia para este DID.')
    console.log('3. Vuelve aquí cuando tengas el JWT.')
    console.log('-------------------------------------------------------------\n')

    // --- PAUSA: El script espera aquí a que tú hagas tus gestiones ---
    
    // 4. PREGUNTAR SERVIDOR
    const serverDid = await preguntar('📡 Paso 1: Introduce el DID del Servidor: ')
    if (!serverDid.startsWith('did:')) {
        console.error('❌ Error: Formato de DID inválido.')
        return
    }

    // 5. PREGUNTAR LICENCIA
    const jwtInput = await preguntar('🎫 Paso 2: Pega la Licencia (JWT) generada: ')
    if (!jwtInput) {
        console.error('❌ Error: La licencia es obligatoria.')
        return
    }

    // 6. VALIDAR Y GUARDAR
    console.log('\n💾 Guardando configuración...')
    
    // Guardar Configuración JSON
    const config = { serverDid: serverDid }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

    // Validar y Guardar Credencial en DB
    const result = await agent.verifyCredential({ credential: jwtInput })
    if (result.verified) {
        await agent.dataStoreSaveVerifiableCredential({
            verifiableCredential: result.verifiableCredential
        })
        console.log('✅ Licencia válida instalada.')
        console.log('✅ Configuración del servidor guardada.')
        console.log('\n🎉 ¡LISTO! Ejecuta "npx ts-node src/index.ts" para volar.')
    } else {
        console.error('❌ La licencia NO es válida. Configuración abortada.')
        // Borramos el config parcial para no dejar el dron en estado corrupto
        if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()