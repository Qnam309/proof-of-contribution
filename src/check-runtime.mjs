
import { ApiPromise, WsProvider } from '@polkadot/api'

const api = await ApiPromise.create({
  provider: new WsProvider('wss://test-node-v3.portaldot.dev')
})

console.log('Chain:', (await api.rpc.system.chain()).toString())
console.log('Revive transactions:', Object.keys(api.tx.revive || {}))
console.log('Revive storage:', Object.keys(api.query.revive || {}))

await api.disconnect()
