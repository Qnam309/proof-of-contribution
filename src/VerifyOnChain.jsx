import { useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { CheckCircle2, Copy, ExternalLink, Search, XCircle } from 'lucide-react'

const RPC = 'wss://test-node-v3.portaldot.dev'
const STORAGE_KEY = 'poc-onchain-proofs-v1'
const SAMPLE = {
  txHash: '0x8e84f3871cf90ec6c98d87842ee46f618f4b86c37bbaf38a16e48c658394b27d',
  proofHash: '0x20ffba48d931940219c5ad726f2dac0487efbd6cd8d197396461a0411b56f116',
  block: '137579'
}

function savedProof() {
  try {
    const values = Object.values(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
    return values.find(p => p?.txHash && p?.proofHash && p?.blockHash) || null
  } catch { return null }
}

function initialFields() {
  const params = new URLSearchParams(window.location.search)
  const hasLink = params.has('tx') || params.has('proof') || params.has('block')
  if (hasLink) return {
    tx: params.get('tx') || '', proof: params.get('proof') || '', block: params.get('block') || ''
  }
  const saved = savedProof()
  return saved ? { tx: saved.txHash, proof: saved.proofHash, block: saved.blockHash } : SAMPLE
}

function shareUrl(tx, proof, block) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('tx', tx.trim())
  url.searchParams.set('proof', proof.trim())
  url.searchParams.set('block', block.trim())
  return url.href
}

export default function VerifyOnChain() {
  const [initial] = useState(initialFields)
  const [txHash, setTxHash] = useState(initial.tx)
  const [proofHash, setProofHash] = useState(initial.proof)
  const [blockInput, setBlockInput] = useState(initial.block)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [notification, setNotification] = useState('')

  function loadExample() {
    setTxHash(SAMPLE.txHash)
    setProofHash(SAMPLE.proofHash)
    setBlockInput(SAMPLE.block)
    setResult(null)
    setNotification('Sample proof loaded. Press Verify On-chain to check the network.')
  }

  async function copyLink() {
    const url = shareUrl(txHash, proofHash, blockInput)
    try { await navigator.clipboard.writeText(url); setNotification('Share link copied. Anyone can verify it without connecting a wallet.') }
    catch { setNotification('Copy failed. Please copy the URL from your browser manually.') }
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
      const hex64 = /^0x[0-9a-f]{64}$/
      if (!hex64.test(tx) || !hex64.test(proof)) throw new Error('Transaction hash and proof hash must be 0x plus 64 hex characters.')
      if (!(hex64.test(blockValue.toLowerCase()) || /^\d+$/.test(blockValue))) throw new Error('Enter a block hash or a block number.')

      api = await ApiPromise.create({ provider: new WsProvider(RPC) })
      const chain = (await api.rpc.system.chain()).toString()
      if (!chain.toLowerCase().includes('portaldot')) throw new Error('Connected RPC is not the expected Portaldot network.')
      const resolvedHash = /^\d+$/.test(blockValue)
        ? (await api.rpc.chain.getBlockHash(blockValue)).toHex()
        : blockValue
      const signedBlock = await api.rpc.chain.getBlock(resolvedHash)
      const header = signedBlock.block.header
      const blockNumber = header.number.toString()
      const canonicalHash = (await api.rpc.chain.getBlockHash(blockNumber)).toHex()
      if (canonicalHash.toLowerCase() !== resolvedHash.toLowerCase()) throw new Error('The block is not on the current canonical chain.')
      const finalHead = await api.rpc.chain.getFinalizedHead()
      const finalHeader = await api.rpc.chain.getHeader(finalHead)
      if (BigInt(blockNumber) > BigInt(finalHeader.number.toString())) throw new Error('Block has not reached finality yet.')
      const extrinsics = signedBlock.block.extrinsics
      const index = extrinsics.findIndex(ext => ext.hash.toHex().toLowerCase() === tx)
      if (index < 0) throw new Error('Transaction was not found in this block.')
      const extrinsic = extrinsics[index]
      if (extrinsic.method.section !== 'system' || extrinsic.method.method !== 'remarkWithEvent') throw new Error('Transaction is not system.remarkWithEvent.')
      const storedRemark = extrinsic.method.args[0].toHex().toLowerCase()
      if (storedRemark !== proof) throw new Error('On-chain remark does not match the supplied proof hash.')
      const events = await api.query.system.events.at(resolvedHash)
      const ownEvents = events.filter(record => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index)
      const success = ownEvents.some(record => record.event.section === 'system' && record.event.method === 'ExtrinsicSuccess')
      const remarked = ownEvents.some(record => record.event.section === 'system' && record.event.method === 'Remarked')
      if (!success || !remarked) throw new Error('Successful execution and Remarked event were not both found.')
      setResult({ valid: true, chain, blockNumber, blockHash: resolvedHash, extrinsicIndex: index,
        signer: extrinsic.signer.toString(), transaction: extrinsic.hash.toHex(), proof: storedRemark })
    } catch (error) {
      console.error(error)
      setResult({ valid: false, message: error.message || String(error) })
    } finally {
      if (api) await api.disconnect().catch(() => {})
      setLoading(false)
    }
  }

  return (
    <section className="poc-section" id="verify-onchain">
      <div className="section-heading"><h2>Verify On-chain</h2><span>Live Portaldot V3 check</span></div>
      <p className="poc-description">Anyone can independently check a proof using a shared link — no wallet or tPOT needed to verify.</p>
      <div className="poc-share-tools">
        <button type="button" onClick={loadExample}><Search size={15}/> Load sample proof</button>
        <button type="button" onClick={copyLink} disabled={!txHash || !proofHash || !blockInput}><Copy size={15}/> Copy share link</button>
      </div>
      <form className="poc-form" onSubmit={verify}>
        <label htmlFor="onchain-tx">Transaction hash</label>
        <input id="onchain-tx" value={txHash} onChange={e => setTxHash(e.target.value)} placeholder="0x..." required/>
        <label htmlFor="onchain-proof">Proof hash</label>
        <input id="onchain-proof" value={proofHash} onChange={e => setProofHash(e.target.value)} placeholder="0x..." required/>
        <label htmlFor="onchain-block">Block number or block hash</label>
        <input id="onchain-block" value={blockInput} onChange={e => setBlockInput(e.target.value)} placeholder="137579 or 0x..." required/>
        <p className="poc-note">A share URL includes these three values. The verifier fetches and validates the actual transaction from the V3 blockchain.</p>
        <button className="poc-submit" type="submit" disabled={loading}><Search size={17}/>{loading ? 'Verifying...' : 'Verify On-chain'}</button>
      </form>
      {notification && <p className="poc-message" role="status">{notification}</p>}
      {result && <div className="poc-verify-result">
        <div className="poc-verify-heading">{result.valid ? <CheckCircle2 size={21} color="#7ce5ac"/> : <XCircle size={21} color="#ff9eae"/>}<strong>{result.valid ? 'ON-CHAIN VERIFIED' : 'NOT VERIFIED'}</strong></div>
        {result.valid ? <>
          <p>Transaction inclusion, proof data, execution event and finalized block verified on {result.chain}.</p>
          <p><strong>Block:</strong> {result.blockNumber}</p>
          <p><strong>Extrinsic index:</strong> {result.extrinsicIndex}</p>
          <p className="poc-wrap"><strong>Signer:</strong> {result.signer}</p>
          <p className="poc-wrap"><strong>Transaction:</strong> {result.transaction}</p>
          <p className="poc-wrap"><strong>Proof:</strong> {result.proof}</p>
          <div className="poc-share-tools"><button type="button" onClick={copyLink}><Copy size={15}/> Copy verified proof link</button></div>
          <p className="poc-note">Verification proves that the signer published this hash on-chain. It does not prove the underlying contribution was genuine or approved by an authorized reviewer.</p>
        </> : <p>{result.message}</p>}
      </div>}
    </section>
  )
}
