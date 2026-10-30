import { useEffect, useState } from 'react'
import {
  createPublicClient, createWalletClient, custom,
  defineChain, formatEther, http
} from 'viem'
import abi from './contributionRegistryAbi.json'
import { PORTALDOT_V3 } from './contractConfig.js'
import { EXTERNAL_META_PREFIX, EVIDENCE_URI_MAX_BYTES, evidenceByteLength, makeExternalMetadata, fetchExternalMetadata, METADATA_CATEGORIES } from './EvmRegistryShared.js'

const chain = defineChain({
  id: PORTALDOT_V3.chainId,
  name: 'Portaldot V3 EVM Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_V3.rpcUrl] } },
  testnet: true
})
const client = createPublicClient({ chain, transport: http(PORTALDOT_V3.rpcUrl) })
const contract = PORTALDOT_V3.contractAddress

export default function EvmSubmitPanel({ provider, account, walletKind }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Community')
  const [description, setDescription] = useState('')
  const [evidenceURI, setEvidenceURI] = useState('')
  const [metadataUrl, setMetadataUrl] = useState('')
  const [uploadedFields, setUploadedFields] = useState('')
  const [preview, setPreview] = useState(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lastHash, setLastHash] = useState('')

  useEffect(() => {
    setPreview(null)
    setChecked(false)
  }, [account, walletKind])

  function update(setter, value) { setter(value); setPreview(null); setChecked(false); setMetadataUrl(''); setUploadedFields('') }
  const canUseEvm = !!provider && !!account && ['metamask', 'okx'].includes(walletKind)
  const pointer = EXTERNAL_META_PREFIX + metadataUrl.trim()
  const encodedSize = evidenceByteLength(pointer)
  const withinContractLimit = encodedSize <= EVIDENCE_URI_MAX_BYTES

  async function validateWallet() {
    if (!canUseEvm) throw Error('Choose MetaMask or OKX Wallet using Connect Wallet first.')
    const chainId = Number(BigInt(await provider.request({ method: 'eth_chainId' })))
    if (chainId !== chain.id) throw Error('Switch your wallet to Portaldot V3 Testnet (420420777).')
    const addresses = await provider.request({ method: 'eth_accounts' })
    if (!addresses?.some(a => a.toLowerCase() === account.toLowerCase())) {
      throw Error('The connected EVM account changed. Reconnect your wallet.')
    }
  }

  const currentFields = () => ({ title: title.trim(), category, description: description.trim(), evidenceUrl: evidenceURI.trim() })
  const currentFingerprint = () => JSON.stringify(currentFields())

  async function uploadMetadata() {
    const fields = currentFields()
    if (uploadedFields === currentFingerprint() && metadataUrl) return metadataUrl
    const metadata = makeExternalMetadata(fields)
    const hashData = new TextEncoder().encode(metadata)
    const digest = await crypto.subtle.digest('SHA-256', hashData)
    const hash = '0x' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    const timestamp = Date.now()
    const message = `PoC metadata upload on Portaldot V3\nWallet: ${account.toLowerCase()}\nSHA-256: ${hash}\nTimestamp: ${timestamp}\nNo blockchain transaction.`
    setMessage('Confirm the free wallet signature to authorize metadata upload. This is NOT a blockchain transaction.')
    const wallet = createWalletClient({ chain, transport: custom(provider) })
    const signature = await wallet.signMessage({ account, message })
    setMessage('Uploading metadata to Vercel Blob through the secure server function...')
    const response = await fetch('/api/upload-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, address: account, signature, timestamp })
    })
    let result
    try { result = await response.json() } catch { throw Error('Server did not return JSON. Run with `npx vercel dev` to enable /api endpoints, not only `npm run dev`.') }
    if (!response.ok) throw Error(result.error || `Blob upload error (HTTP ${response.status}).`)
    if (typeof result.metadataUrl !== 'string') throw Error('Upload response missing Blob metadata link.')
    setMetadataUrl(result.metadataUrl)
    setUploadedFields(currentFingerprint())
    return result.metadataUrl
  }

  async function waitForHostedMetadata(url) {
    let lastError
    for (let i = 0; i < 5; i++) {
      try { return await fetchExternalMetadata(url) } catch (e) { lastError = e }
      await new Promise(r => setTimeout(r, 1800))
    }
    throw Error(`Metadata uploaded but not yet readable. Try Check gas again in a moment. ${lastError?.message || ''}`)
  }

  async function checkGas() {
    setBusy(true); setPreview(null); setChecked(false); setMessage('Checking contract and gas...')
    try {
      await validateWallet()
      const url = new URL(evidenceURI.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('Enter a valid HTTP(S) evidence URL.')
      if (!title.trim() || title.trim().length > 120) throw Error('Enter a contribution title (up to 120 characters).')
      if (!description.trim() || description.trim().length > 400) throw Error('Enter a description (up to 400 characters).')
      if (evidenceURI.trim().length > 500) throw Error('Evidence URL is too long (max 500 characters).')
      const uploadedUrl = await uploadMetadata()
      const evidence = EXTERNAL_META_PREFIX + uploadedUrl
      const bytes = evidenceByteLength(evidence)
      if (bytes > EVIDENCE_URI_MAX_BYTES) throw Error(`Metadata pointer is ${bytes}/${EVIDENCE_URI_MAX_BYTES} bytes. Shorten the Raw URL.`)
      setMessage('Uploaded. Fetching the hosted JSON to calculate its real SHA-256...')
      const remote = await waitForHostedMetadata(uploadedUrl)
      const expected = { title: title.trim(), category, description: description.trim(), evidenceUrl: evidenceURI.trim() }
      for (const key of Object.keys(expected)) {
        if (remote.metadata[key] !== expected[key]) throw Error(`Hosted metadata does not match the form field: ${key}.` )
      }
      const contentHash = remote.hash
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
      setPreview({ evidence, contentHash, gasLimit, gasPrice, reserve, expectedId, account, fields: { title: title.trim(), category, description: description.trim(), evidenceUrl: evidenceURI.trim() } })
      setMessage(`On-chain pointer size: ${bytes}/${EVIDENCE_URI_MAX_BYTES} bytes\nExternal JSON size: ${remote.bytes} bytes\nExternal JSON hash checked against form: YES\nMetadata URL: ${uploadedUrl}\n\nTitle: ${title.trim()}\nCategory: ${category}\nDescription: ${description.trim()}\nEvidence URL: ${evidenceURI.trim()}\n\nExpected contribution ID: ${expectedId}\nSHA-256: ${contentHash}\nGas reserve (estimate): ${formatEther(reserve)} POT\nWallet balance: ${formatEther(balance)} POT\nThis is not the final fee.`)
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
      if (preview.account.toLowerCase() !== account.toLowerCase() || preview.evidence !== EXTERNAL_META_PREFIX + metadataUrl.trim() || Object.keys(preview.fields).some(k => preview.fields[k] !== ({ title: title.trim(), category, description: description.trim(), evidenceUrl: evidenceURI.trim() })[k])) {
        throw Error('Evidence or wallet changed. Check gas again.')
      }
      const fresh = await fetchExternalMetadata(metadataUrl.trim())
      if (fresh.hash.toLowerCase() !== preview.contentHash.toLowerCase()) throw Error('Hosted metadata changed since gas check. Check again.')
      const currentPrice = await client.getGasPrice()
      if (currentPrice > preview.gasPrice) throw Error('Gas price increased. Check gas again.')
      const balance = await client.getBalance({ address: account })
      if (balance < preview.reserve) throw Error('Insufficient POT. Check gas again.')
      const duplicate = await client.readContract({ address: contract, abi, functionName: 'submittedHashes', args: [account, preview.contentHash] })
      if (duplicate) throw Error('This content hash was already submitted from this account.')
      const ok = window.confirm(
        `Send a REAL V3 TESTNET transaction?\n\nContribution: ${title.trim()}\nCategory: ${category}\nEvidence link: ${evidenceURI.trim()}\nSHA-256: ${preview.contentHash}\nGas limit × gas price: ${formatEther(preview.reserve)} POT\n\nYour wallet will ask for final confirmation.`
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
      setMessage(`ON-CHAIN SUBMIT SUCCESS\nTX: ${hash}\nBlock: ${receipt.blockNumber}\nGas used: ${receipt.gasUsed}\nEffective gas price (wei): ${receipt.effectiveGasPrice ?? "unavailable"}\nContribution: ${title.trim()}\nEvidence: ${evidenceURI.trim()}\nHash: ${preview.contentHash}\nEstimated contribution ID before sending: ${preview.expectedId}\n\nSave this TX hash. The ID needs confirmation from on-chain record if concurrent submissions occurred.`)
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
      <p className="ui-help">Fill in the details, then click Check on-chain gas. The app automatically uploads a public JSON record to Vercel Blob (with one free wallet signature), verifies the stored bytes, and estimates V3 gas. Only the SHA-256 and public Blob URL go on-chain. Never include private information; metadata is public.</p>
      <p className="ui-help">Selected EVM wallet: {canUseEvm ? `${walletKind} · ${account}` : 'Not connected — choose MetaMask or OKX Wallet'}</p>
      <label htmlFor="evm-title">Contribution title *</label>
      <input id="evm-title" value={title} onChange={e => update(setTitle, e.target.value)} placeholder="e.g. Portaldot V3 Beginner Guide" maxLength={120} required />
      <label htmlFor="evm-category">Category *</label>
      <select id="evm-category" value={category} onChange={e => update(setCategory, e.target.value)}>
        {['Community', 'Education', 'Development', 'Content', 'Design', 'Other'].map(c => <option key={c}>{c}</option>)}
      </select>
      <label htmlFor="evm-description">Description *</label>
      <textarea id="evm-description" value={description} onChange={e => update(setDescription, e.target.value)} placeholder="Describe your contribution, impact, and what the evidence shows..." rows={5} maxLength={400} required />
      <p className="ui-help">{description.length}/400 characters · Description is stored in external JSON, not directly in the contract.</p>
      <p className="ui-help" style={{ color: withinContractLimit ? 'inherit' : '#dc2626', fontWeight: withinContractLimit ? 'normal' : 700 }}>On-chain pointer size after upload: {metadataUrl ? `${encodedSize}/${EVIDENCE_URI_MAX_BYTES} bytes` : "will be measured after Blob upload"}</p>
      <label htmlFor="evm-evidence">Evidence URL *</label>
      <input id="evm-evidence" type="url" value={evidenceURI} placeholder="https://github.com/..." maxLength={500} onChange={e => update(setEvidenceURI, e.target.value)} required />
      {metadataUrl && <p className="ui-help">Uploaded metadata: <a href={metadataUrl} target="_blank" rel="noopener noreferrer">View stored JSON</a> · {metadataUrl}</p>}
      <p className="ui-help">Note: This uploader requires the Vercel server function and a PUBLIC Vercel Blob Store and server-side Vercel authentication. Local preview should run with <code>npx vercel dev</code>.</p>
      <button type="button" className="ui-btn ui-outline" disabled={!canUseEvm || busy || !evidenceURI.trim() || !title.trim() || !description.trim()} onClick={checkGas}>
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
