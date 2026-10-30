import { ApiPromise, WsProvider } from '@polkadot/api'

const api = await ApiPromise.create({
  provider: new WsProvider('wss://test-node-v3.portaldot.dev')
})

try {
  const header = await api.rpc.chain.getHeader()
  console.log('Latest block:', header.number.toString())

  const pending = await api.rpc.author.pendingExtrinsics()
  console.log('Pending transactions:', pending.length)

  for (const tx of pending) {
    console.log('Hash:', tx.hash.toHex())
    console.log('Method:', tx.method.section, tx.method.method)
    console.log('Signer:', tx.isSigned ? tx.signer.toString() : 'Unsigned')
  }
} finally {
  await api.disconnect()
}