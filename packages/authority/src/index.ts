import { createSSIAgent } from '@tfm/shared'
import * as readline from 'readline'

// Función auxiliar para preguntar por consola
function preguntar(pregunta: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close()
      resolve(respuesta.trim()) // Quitamos espacios sobrantes por si acaso
    })
  })
}

async function main() {
  console.log('🏛️  Iniciando Autoridad de Certificación (Modo Interactivo)...')

  const AUTHORITY_SECRET = '99999999cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8999'
  const DB_FILE = 'authority-database.sqlite'

  try {
    // 1. Inicializamos el Agente
    const agent = await createSSIAgent(DB_FILE, AUTHORITY_SECRET)

    // 2. Obtenemos la identidad de la Autoridad
    let authorityIdentifier = (await agent.didManagerFind())[0]
    
    if (!authorityIdentifier) {
        authorityIdentifier = await agent.didManagerCreate({ 
            alias: 'Authority-01', 
            provider: 'did:key' 
        })
    }
    
    console.log(`✅ Autoridad Activa: ${authorityIdentifier.did}`)
    console.log('-------------------------------------------------------')

    // 3. INTERACCIÓN CON EL USUARIO
    // Aquí el script se pausa esperando a que pegues el DID
    const targetDID = await preguntar('👉 Por favor, introduce el DID del Dron (did:key:...): ')

    if (!targetDID || !targetDID.startsWith('did:')) {
        console.error('❌ Error: El formato del DID no es válido.')
        return
    }

    console.log(`\n⚙️  Generando licencia para: ${targetDID}...`)

    // 4. CREAR LA CREDENCIAL (VC)
    const verifiableCredential = await agent.createVerifiableCredential({
      credential: {
        issuer: { id: authorityIdentifier.did },
        credentialSubject: {
          id: targetDID,          // Usamos el DID que acabas de escribir
          type: 'DroneLicense',
          licenseClass: 'Class-A',
          expiryDate: '2030-01-01',
          authorizedArea: 'Madrid-Norte'
        },
      },
      proofFormat: 'jwt',
      save: true
    })

    console.log('📜 ¡Credencial Creada y Firmada!')
    console.log('---------------------------------------------------')
    console.log(verifiableCredential.proof.jwt)
    console.log('---------------------------------------------------')
    console.log('✅ Copia el JWT de arriba y úsalo en el script de instalación del dron.')

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()