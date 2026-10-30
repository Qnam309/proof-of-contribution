import { createPublicClient, defineChain, http } from 'viem'
import abi from './contributionRegistryAbi.json'
import { PORTALDOT_V3 } from './contractConfig.js'

export const registryAddress = PORTALDOT_V3.contractAddress
export const registryAbi = abi
export const registryChain = defineChain({
  id: PORTALDOT_V3.chainId,
  name: 'Portaldot V3 Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_V3.rpcUrl] } },
  testnet: true
})
export const registryClient = createPublicClient({
  chain: registryChain,
  transport: http(PORTALDOT_V3.rpcUrl)
})

export const statusName = (status) => ({
  0: 'Unknown', 1: 'Pending Review', 2: 'Approved', 3: 'Rejected'
})[Number(status)] || `Unknown (${status})`

export async function validateSelectedEvm(provider, account, walletKind) {
  if (!provider || !account || !['metamask', 'okx'].includes(walletKind)) {
    throw Error('Connect MetaMask or OKX Wallet using Connect Wallet first.')
  }
  const chainId = Number(BigInt(await provider.request({ method: 'eth_chainId' })))
  if (chainId !== registryChain.id) throw Error('Select Portaldot V3 EVM Testnet (Chain ID 420420777).')
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (!accounts?.some(a => a.toLowerCase() === account.toLowerCase())) {
    throw Error('The connected account changed. Reconnect from Connect Wallet.')
  }
}

export async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return '0x' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function loadContribution(id) {
  const [nextId, contribution] = await Promise.all([
    registryClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'nextId' }),
    registryClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getContribution', args: [id] })
  ])
  if (id < 1n || id >= nextId) throw Error('Contribution ID does not exist on V3.')
  return contribution
}
