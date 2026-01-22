import { agent, initializeDatabase }  from './agent'

async function main() {
    await initializeDatabase()
    console.log('Agent initialized and database connected.')


    // 1. Check if there is an existing DID with the alias 'drone-default'
    const existingDID = await agent.didManagerFind({
        alias: 'drone-default',
    })

    let identifier

    if (existingDID.length > 0) {
        identifier = existingDID[0]
        console.log('Existing DID found:', identifier.did)
    } else {
        identifier = await agent.didManagerCreate({
            alias: 'drone-default',
            // provider: 'did:web',
        })
        console.log('New DID created: ', identifier.did)
    }

    console.log(identifier)

}

main().catch(console.error)