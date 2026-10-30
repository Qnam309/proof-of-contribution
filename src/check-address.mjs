
import { ApiPromise, WsProvider } from '@polkadot/api'
import { encodeAddress } from '@polkadot/util-crypto'

const evm = '0x50C7FAbAfE8716D19D31c3853589BADBD56541C2'

const api = await ApiPromise.create({
  provider: new WsProvider('wss://test-node-v3.portaldot.dev')
})

try {
  const prefix = api.consts.system.ss58Prefix.toNumber()
  const accountId = evm + 'ee'.repeat(12)
  const nativeAddress = encodeAddress(accountId, prefix)

  const mapped = await api.query.revive.originalAccount(evm)
  const nativeBalance = await api.query.system.account(nativeAddress)

  console.log('Network:', (await api.rpc.system.chain()).toString())
  console.log('SS58 prefix:', prefix)
  console.log('MetaMask:', evm)
  console.log('Revive fallback candidate:', nativeAddress)
  console.log('Account ID:', accountId)
  console.log('Existing mapping:', mapped.toHuman())
  console.log('Candidate native balance:', nativeBalance.data.free.toString())
  console.log('READ ONLY — DO NOT TRANSFER YET')
} finally {
  await api.disconnect()
}
