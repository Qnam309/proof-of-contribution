import { useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { CheckCircle2, Copy, Search, XCircle } from 'lucide-react'

const RPC = 'wss://test-node-v3.portaldot.dev'
const STORAGE_KEY = 'poc-onchain-proofs-v1'
const SAMPLE = {
  txHash: '0x8e84f3871cf90ec6c98d87842ee46f618f4b86c37bbaf38a16e48c658394b27d',
  proofHash: '0x20ffba48d931940219c5ad726f2dac0487efbd6cd8d197396461a0411b56f116',
  block: '137579'
}
const HEX64 = /^0x[0-9a-f]{64}$/
const REAL_ANCHOR = {
  txHash: '0xa69a10efa9d01c7490fb6f35b34138851d2f55e9a318daa78d1fa4bde826755b',
  proofHash: '0xabaec1d5aa5a84809f1efbfbfe880b4f0811ef38445688751e35523cab139ae1',
  block: '325447'
}


function readSavedProofs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return []
    return Object.entries(saved).filter(([, item]) => item &&
      HEX64.test(String(item.txHash || '').toLowerCase()) &&
      HEX64.test(String(item.proofHash || '').toLowerCase()) &&
      (HEX64.test(String(item.blockHash || '').toLowerCase()) || /^\d+$/.test(String(item.block || ''))))
      .map(([key, item]) => ({
        key,
        title: item.title || item.contributionId || key,
        txHash: item.txHash,
        proofHash: item.proofHash,
        block: item.blockHash || item.block
      }))
  } catch { return [] }
}

function initialSelection(saved) {
  const params = new URLSearchParams(window.location.search)
  if (params.has('tx') || params.has('proof') || params.has('block')) {
    return { kind: 'link', txHash: params.get('tx') || '', proofHash: params.get('proof') || '', block: params.get('block') || '' }
  }
  if (saved.length) return { kind: `saved:${saved[0].key}`, ...saved[0] }
  return { kind: 'empty', txHash: '', proofHash: '', block: '' }
}

function proofLink(tx, proof, block) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('tx', tx.trim())
  url.searchParams.set('proof', proof.trim())
  url.searchParams.set('block', block.trim())
  return url.href
}

export default function VerifyOnChain() {
  const [saved] = useState(readSavedProofs)
  const [initial] = useState(() => initialSelection(saved))
  const [source, setSource] = useState(initial.kind)
  const [txHash, setTxHash] = useState(initial.txHash)
  const [proofHash, setProofHash] = useState(initial.proofHash)
  const [blockInput, setBlockInput] = useState(initial.block)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [notification, setNotification] = useState('')

  function applyProof(proof, kind) {
    setSource(kind)
    setTxHash(proof.txHash || '')
    setProofHash(proof.proofHash || '')
    setBlockInput(proof.block || '')
    setResult(null)
    setNotification(kind === 'real' ? 'Contribution #2 native anchor loaded from the real finalized transaction at block 325447. Press Verify On-chain.' : kind === 'sample' ? 'Example loaded. Choose Verify On-chain to check it live.' : 'Proof details loaded. Choose Verify On-chain to check them live.')
  }

  function chooseSource(value) {
    if (value === 'sample') return applyProof(SAMPLE, 'sample')
    if (value === 'real') return applyProof(REAL_ANCHOR, 'real')
    if (value.startsWith('saved:')) {
      const match = saved.find(item => `saved:${item.key}` === value)
      if (match) return applyProof(match, value)
    }
    applyProof({ txHash: '', proofHash: '', block: '' }, 'custom')
  }

  function edit(setter, value) {
    setter(value)
    setSource('custom')
    setResult(null)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(proofLink(txHash, proofHash, blockInput))
      setNotification('Proof link copied. Opening it fills the fields; the recipient must select Verify On-chain to check the blockchain.')
    } catch { setNotification('Could not copy. Check clipboard permissions.') }
  }

  async function verify(event) {
    event.preventDefault()
    setLoading(true)
    setResult(null)
    setNotification('')
    let api
    try {
      const tx = txHash.trim().toLowerCase()
      const proof = proofHash.trim().toLowerCase()
      const blockValue = blockInput.trim()
      if (!HEX64.test(tx) || !HEX64.test(proof)) throw Error('Transaction hash and proof hash must each contain 0x followed by 64 hex characters.')
      if (!(HEX64.test(blockValue.toLowerCase()) || /^\d+$/.test(blockValue))) throw Error('Enter a valid native block number or 0x block hash.')
      api = await ApiPromise.create({ provider: new WsProvider(RPC) })
      const chain = (await api.rpc.system.chain()).toString()
      if (!chain.toLowerCase().includes('portaldot')) throw Error('The connected RPC is not the expected Portaldot network.')
      const blockHash = /^\d+$/.test(blockValue)
        ? (await api.rpc.chain.getBlockHash(blockValue)).toHex() : blockValue
      const signed = await api.rpc.chain.getBlock(blockHash)
      const blockNumber = signed.block.header.number.toString()
      const canonicalHash = (await api.rpc.chain.getBlockHash(blockNumber)).toHex()
      if (canonicalHash.toLowerCase() !== blockHash.toLowerCase()) throw Error('This block is not on the canonical chain.')
      const finalizedHash = await api.rpc.chain.getFinalizedHead()
      const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash)
      if (BigInt(blockNumber) > BigInt(finalizedHeader.number.toString())) throw Error('This block is not finalized yet.')
      const extrinsics = signed.block.extrinsics
      const index = extrinsics.findIndex(ext => ext.hash.toHex().toLowerCase() === tx)
      if (index < 0) throw Error('Transaction not found in the specified block.')
      const extrinsic = extrinsics[index]
      if (extrinsic.method.section !== 'system' || extrinsic.method.method !== 'remarkWithEvent') throw Error('Transaction is not a system.remarkWithEvent proof.')
      const storedHash = extrinsic.method.args[0].toHex().toLowerCase()
      if (storedHash !== proof) throw Error('The recorded proof hash differs from the supplied proof hash.')
      const events = await api.query.system.events.at(blockHash)
      const relevant = events.filter(item => item.phase.isApplyExtrinsic && item.phase.asApplyExtrinsic.toNumber() === index)
      const success = relevant.some(item => item.event.section === 'system' && item.event.method === 'ExtrinsicSuccess')
      const remarked = relevant.some(item => item.event.section === 'system' && item.event.method === 'Remarked')
      if (!success || !remarked) throw Error('The transaction did not have both ExtrinsicSuccess and Remarked events.')
      setResult({ valid: true, chain, blockNumber, index, signer: extrinsic.signer.toString(), txHash: extrinsic.hash.toHex(), proofHash: storedHash })
    } catch (error) {
      setResult({ valid: false, message: error?.message || String(error) })
    } finally {
      if (api) await api.disconnect().catch(() => {})
      setLoading(false)
    }
  }

  const ready = HEX64.test(txHash.trim().toLowerCase()) && HEX64.test(proofHash.trim().toLowerCase()) &&
    (HEX64.test(blockInput.trim().toLowerCase()) || /^\d+$/.test(blockInput.trim()))
  const sourceLabel = source === 'real' ? 'Real Contribution #2 native anchor · block 325447' : source === 'sample' ? 'Public example at block 137579' :
    source.startsWith('saved:') ? 'Previously saved in this browser (not yet checked)' :
    source === 'link' ? 'Opened from a shared link (not yet checked)' :
    source === 'custom' ? 'Manually entered proof (not yet checked)' : 'No proof selected'

  return <section className="poc-section" id="verify-onchain">
    <div className="section-heading"><h2>Native Proof Verification</h2><span>Portaldot V3 native chain</span></div>
    <p className="poc-description">This checks whether a SHA-256 proof hash was recorded in a finalized native transaction. It does not review or approve a contribution. Verification is read-only, free, and does not require a wallet.</p>
    <div className="ui-info" role="note" style={{marginBottom:16}}>
      <CheckCircle2 size={19}/> <span><strong>1. Choose a proof</strong> → <strong>2. Verify On-chain</strong> → <strong>3. Copy the link</strong>. The example is only a demonstration; you can verify any compatible remarkWithEvent transaction.</span>
    </div>
    <div className="ui-form" style={{padding:0}}>
      <div className="ui-info" style={{display:'block', marginBottom:16}}>
        <strong>Try a real Portaldot V3 anchor</strong>
        <p>Contribution #2 · Native block #325447 · Extrinsic #1. Verify a real finalized remarkWithEvent transaction and its SHA-256. This is not a simulated record.</p>
        <button type="button" className="ui-btn ui-primary" onClick={() => applyProof(REAL_ANCHOR, 'real')} disabled={loading}>Load Real Native Proof Example</button>
      </div>
      <label htmlFor="native-proof-source">Which proof do you want to check?</label>
      <select id="native-proof-source" value={source} onChange={event => chooseSource(event.target.value)}>
        <option value="empty" disabled>No proof selected</option>
        <option value="real">Real Unified Proof — Contribution #2 · block 325447</option>
        <option value="sample">Earlier native example — block 137579</option>
        {saved.map((item, index) => <option key={item.key} value={`saved:${item.key}`}>Saved proof {index + 1} — {String(item.title).slice(0, 45)}</option>)}
        {source === 'link' && <option value="link" disabled>Proof from shared link</option>}
        <option value="custom">Enter another proof manually</option>
      </select>
      <p className="ui-help" role="status"><strong>Current source:</strong> {sourceLabel}. {source.startsWith('saved:') ? 'Saved proofs are only stored in your browser; they are not a complete on-chain history.' : ''}</p>
      <form className="poc-form" onSubmit={verify}>
        <label htmlFor="onchain-tx">Transaction hash</label>
        <input id="onchain-tx" value={txHash} onChange={event => edit(setTxHash, event.target.value)} placeholder="0x..." required/>
        <label htmlFor="onchain-proof">Proof hash (SHA-256)</label>
        <input id="onchain-proof" value={proofHash} onChange={event => edit(setProofHash, event.target.value)} placeholder="0x..." required/>
        <label htmlFor="onchain-block">Block number or block hash</label>
        <input id="onchain-block" value={blockInput} onChange={event => edit(setBlockInput, event.target.value)} placeholder="137579 or 0x..." required/>
        <p className="poc-note">The example fills these fields only. A real check happens when you press Verify On-chain. Block 154160 is not an additional built-in sample.</p>
        <button className="poc-submit" type="submit" disabled={loading || !ready}><Search size={17}/>{loading ? 'Verifying native transaction...' : 'Verify On-chain (free)'}</button>
      </form>
      {notification && <p className="poc-message" role="status">{notification}</p>}
      {result && <div className="poc-verify-result" role="status">
        <div className="poc-verify-heading">{result.valid ? <CheckCircle2 size={21} color="#7ce5ac"/> : <XCircle size={21} color="#ff9eae"/>}<strong>{result.valid ? 'ON-CHAIN VERIFIED' : 'NOT VERIFIED'}</strong></div>
        {result.valid ? <>
          <p>Finalized block, transaction inclusion, remark hash and success events verified on {result.chain}.</p>
          <p><strong>Block:</strong> {result.blockNumber} · <strong>Extrinsic:</strong> #{result.index}</p>
          <p className="poc-wrap"><strong>Signer:</strong> {result.signer}</p>
          <p className="poc-wrap"><strong>Transaction:</strong> {result.txHash}</p>
          <p className="poc-wrap"><strong>Proof hash:</strong> {result.proofHash}</p>
          <button className="ui-btn ui-outline" type="button" onClick={copyLink}><Copy size={15}/> Copy verified proof link</button>
          <p className="poc-note">The link lets others independently repeat this check; it does not certify that the underlying work was genuine or approved by a reviewer.</p>
        </> : <p>{result.message}</p>}
      </div>}
    </div>
  </section>
}
