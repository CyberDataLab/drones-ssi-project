import { agent, initializeDatabase }  from './agent'

async function main() {
    await initializeDatabase()
    console.log('Agent initialized and database connected.')

    const identifier = await agent.didManagerCreate({ alias: 'drone-default' })
    console.log('DID created:', identifier)
}

main().catch(console.error)