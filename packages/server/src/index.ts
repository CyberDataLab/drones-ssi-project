import { createSSIAgent } from '@tfm/shared'
import express, { Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  console.log('🖥️  Iniciando Servidor de IA (Verifier + Data Ingestion)...')

  const SERVER_SECRET_KEY = '55555555cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa8555'
  const DB_FILE = 'server-database.sqlite'
  const PORT = 3000
  
  // Archivo donde guardaremos el Dataset para la IA
  const DATASET_FILE = path.join(__dirname, '../drones-dataset.csv')

  // Inicializamos el CSV con cabeceras si no existe
  if (!fs.existsSync(DATASET_FILE)) {
    fs.writeFileSync(DATASET_FILE, 'timestamp,did,battery,altitude,temperature\n')
    console.log('📁 Nuevo dataset creado: drones-dataset.csv')
  }

  try {
    const agent = await createSSIAgent(DB_FILE, SERVER_SECRET_KEY)
    
    // Identidad
    const existingDids = await agent.didManagerFind()
    let serverIdentifier = existingDids.length > 0 
      ? existingDids[0] 
      : await agent.didManagerCreate({ alias: 'AI-Server-01', provider: 'did:key' })
    
    console.log(`✅ Identidad del Servidor: ${serverIdentifier.did}`)
    console.log('---------------------------------------------------------')
    console.log('💾 MODO DATASET: Los datos verificados se guardarán en CSV.')
    console.log('---------------------------------------------------------')

    const app = express()
    app.use(express.json()) 

    app.post('/messaging', async (req: Request, res: Response) => {
      try {
        // 1. Desencriptar
        const message = await agent.handleMessage({
          raw: JSON.stringify(req.body),
        })

        // 2. Parsear Payload de forma segura
        let payload = message.data as any
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload) } catch (e) {}
        }
        const body = payload.body || payload 
        const credentials = body.verifiableCredential

        // 3. Verificar Existencia de Credencial
        if (!credentials || credentials.length === 0) {
           console.log('⛔ DENEGADO: Sin credenciales.')
           res.status(401).send('No credentials')
           return
        }

        // 4. Verificar Validez Criptográfica
        const verificationResult = await agent.verifyCredential({
            credential: credentials[0]
        })

        if (verificationResult.verified === true) {
            // --- AQUÍ EMPIEZA LA PERSISTENCIA ---
            const battery = body.battery || 0
            const altitude = body.altitude || 0
            const temp = body.temperature || 0
            const timestamp = body.timestamp || new Date().toISOString()
            const droneDid = message.from

            // Formato CSV: timestamp,did,battery,altitude,temperature
            const csvLine = `${timestamp},${droneDid},${battery},${altitude},${temp}\n`

            // Escribir en el archivo (Append)
            fs.appendFileSync(DATASET_FILE, csvLine)
            
            console.log(`✅ Dato Guardado: Batería ${battery}% | Alt ${altitude}m`)
            // ------------------------------------
            
            res.json({ status: 'saved', id: message.id })
        } else {
            console.log('❌ LICENCIA INVÁLIDA.')
            res.status(403).send('Invalid Credential')
        }

      } catch (error) {
        console.error('❌ Error:', error)
        res.status(500).send('Error')
      }
    })

    app.listen(PORT, () => {
      console.log(`🚀 Listo en: http://localhost:${PORT}/messaging`)
    })

  } catch (error) {
    console.error('❌ Error fatal:', error)
  }
}

main()