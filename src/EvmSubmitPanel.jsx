import { useEffect, useState } from 'react'
import {
  createPublicClient, createWalletClient, custom,
  defineChain, formatEther, http
} from 'viem'
import abi from './contributionRegistryAbi.json'
import { PORTALDOT_V3 } from './contractConfig.js'

const chain = defineChain({
  id: PORTALDOT_V3.chainId,
  name: 'Portaldot V3 EVM Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_V3.rpcUrl] } },
  testnet: true
})
const client = createPublicClient({ chain, transport: http(PORTALDOT_V3.rpcUrl) })
const contract = PORTALDOT_V3.contractAddress

async function sha256Utf8(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return '0x' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function EvmSubmitPanel({ provider, account, walletKind }) {
  const [evidenceURI, setEvidenceURI] = useState('')
  const [preview, setPreview] = useState(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lastHash, setLastHash] = useState('')

  useEffect(() => {
    setPreview(null)
    setChecked(false)
  }, [account, walletKind])

  const canUseEvm = !!provider && !!account && ['metamask', 'okx'].includes(walletKind)

  async function validateWallet() {
    if (!canUseEvm) throw Error('Choose MetaMask or OKX Wallet using Connect Wallet first.')
    const chainId = Number(BigInt(await provider.request({ method: 'eth_chainId' })))
    if (chainId !== chain.id) throw Error('Switch your wallet to Portaldot V3 Testnet (420420777).')
    const addresses = await provider.request({ method: 'eth_accounts' })
    if (!addresses?.some(a => a.toLowerCase() === account.toLowerCase())) {
      throw Error('The connected EVM account changed. Reconnect your wallet.')
    }
  }

  async function checkGas() {
    setBusy(true); setPreview(null); setChecked(false); setMessage('Checking contract and gas...')
    try {
      await validateWallet()
      const url = new URL(evidenceURI.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('Enter a valid HTTP(S) evidence URL.')
      const evidence = evidenceURI.trim()
      const contentHash = await sha256Utf8(evidence)
      const submitted = await client.readContract({
        address: contract, abi, functionName: 'submittedHashes', args: [account, contentHash]
      })
      if (submitted) throw Error('This account has already submitted this evidence hash.')
      const args = [contentHash, evidence]
      const gas = await client.estimateContractGas({
        address: contract, abi, functionName: 'submitContribution', args, account
      })
      const gasLimit = (gas * 105n + 99n) / 100n
      const gasPrice = await client.getGasPrice()
      const reserve = gasLimit * gasPrice
      const balance = await client.getBalance({ address: account })
      const expectedId = await client.readContract({ address: contract, abi, functionName: 'nextId' })
      setPreview({ evidence, contentHash, gasLimit, gasPrice, reserve, expectedId, account })
      setMessage(`Expected contribution ID: ${expectedId}\nSHA-256: ${contentHash}\nGas reserve (estimate): ${formatEther(reserve)} POT\nWallet balance: ${formatEther(balance)} POT\nThis is not the final fee.`)
      if (balance < reserve) {
        setPreview(null)
        setMessage(prev => prev + '\nInsufficient tPOT for the estimate. No transaction sent.')
      }
    } catch (e) {
      setMessage('Check failed: ' + (e.shortMessage || e.message))
    } finally { setBusy(false) }
  }

  async function submitOnChain() {
    if (!preview || !checked || busy) return
    setBusy(true)
    try {
      await validateWallet()
      if (preview.account.toLowerCase() !== account.toLowerCase() || preview.evidence !== evidenceURI.trim()) {
        throw Error('Evidence or wallet changed. Check gas again.')
      }
      const currentPrice = await client.getGasPrice()
      if (currentPrice > preview.gasPrice) throw Error('Gas price increased. Check gas again.')
      const balance = await client.getBalance({ address: account })
      if (balance < preview.reserve) throw Error('Insufficient POT. Check gas again.')
      const duplicate = await client.readContract({ address: contract, abi, functionName: 'submittedHashes', args: [account, preview.contentHash] })
      if (duplicate) throw Error('This content hash was already submitted from this account.')
      const ok = window.confirm(
        `Send a REAL V3 TESTNET transaction?\n\nEvidence: ${preview.evidence}\nSHA-256: ${preview.contentHash}\nGas limit × gas price: ${formatEther(preview.reserve)} POT\n\nYour wallet will ask for final confirmation.`
      )
      if (!ok) return
      const wallet = createWalletClient({ chain, transport: custom(provider) })
      setMessage('Open your wallet and review the transaction fee before confirming...')
      const hash = await wallet.writeContract({
        account, chain, address: contract, abi, functionName: 'submitContribution',
        args: [preview.contentHash, preview.evidence],
        gas: preview.gasLimit, gasPrice: preview.gasPrice
      })
      setLastHash(hash)
      setMessage(`TX submitted: ${hash}\nWaiting for receipt...`)
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 })
      if (receipt.status !== 'success') throw Error(`Transaction failed. TX: ${hash}`)
      setMessage(`ON-CHAIN SUBMIT SUCCESS\nTX: ${hash}\nBlock: ${receipt.blockNumber}\nGas used: ${receipt.gasUsed}\nEffective gas price (wei): ${receipt.effectiveGasPrice ?? "unavailable"}\nEvidence: ${preview.evidence}\nHash: ${preview.contentHash}\nEstimated contribution ID before sending: ${preview.expectedId}\n\nSave this TX hash. The ID needs confirmation from on-chain record if concurrent submissions occurred.`)
      setPreview(null)
      setChecked(false)
    } catch (e) {
      setMessage(prev => `${prev}\n\n${e.shortMessage || e.message}`)
    } finally { setBusy(false) }
  }

  return <section className="ui-panel ui-form-panel" style={{ marginTop: 22 }}>
    <div className="ui-panel-head"><div>
      <h2>EVM On-chain Submit</h2>
      <p>Real contribution recorded in ContributionRegistry on Portaldot V3 Testnet.</p>
    </div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      <p className="ui-help">Demo submissions above remain browser-only. Use this separate form for a real blockchain transaction. The SHA-256 hash is computed from the exact evidence URL text.</p>
      <p className="ui-help">Selected EVM wallet: {canUseEvm ? `${walletKind} · ${account}` : 'Not connected — choose MetaMask or OKX Wallet'}</p>
      <label htmlFor="evm-evidence">Evidence URL</label>
      <input id="evm-evidence" type="url" value={evidenceURI} placeholder="https://github.com/..." onChange={e => {
        setEvidenceURI(e.target.value); setPreview(null); setChecked(false)
      }} />
      <button type="button" className="ui-btn ui-outline" disabled={!canUseEvm || busy || !evidenceURI.trim()} onClick={checkGas}>
        {busy ? 'Working...' : 'Check on-chain gas'}
      </button>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.7 }}>{message || 'No transaction sent.'}</pre>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input style={{ width: 'auto' }} type="checkbox" checked={checked} disabled={!preview || busy} onChange={e => setChecked(e.target.checked)} />
        I understand this is a real testnet transaction and can spend tPOT.
      </label>
      <button type="button" className="ui-btn ui-primary" disabled={!preview || !checked || busy} onClick={submitOnChain}>Submit to V3 Smart Contract</button>
      {lastHash && <p className="ui-help">Latest submitted TX: <code style={{ overflowWrap: 'anywhere' }}>{lastHash}</code></p>}
    </div>
  </section>
}
