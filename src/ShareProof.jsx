import { useState } from 'react'
import { ArrowRight, Copy, ExternalLink, Share2 } from 'lucide-react'

const STORAGE_KEY = 'poc-onchain-proofs-v1'
const SAMPLE = {
  txHash: '0x8e84f3871cf90ec6c98d87842ee46f618f4b86c37bbaf38a16e48c658394b27d',
  proofHash: '0x20ffba48d931940219c5ad726f2dac0487efbd6cd8d197396461a0411b56f116',
  block: '137579'
}

function proofLink(proof) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('tx', proof.txHash)
  url.searchParams.set('proof', proof.proofHash)
  url.searchParams.set('block', proof.blockHash || proof.block)
  return url.href
}

export default function ShareProof({ account, contributions }) {
  const [notice, setNotice] = useState('')
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} } catch { /* no local proofs */ }
  const myProofs = (account ? contributions.filter(item => item.contributor === account) : [])
    .filter(item => saved[item.id]?.txHash && saved[item.id]?.proofHash && saved[item.id]?.blockHash)
    .map(item => ({ title: item.title, proof: saved[item.id] }))

  async function copyProof(proof) {
    try {
      await navigator.clipboard.writeText(proofLink(proof))
      setNotice('Share link copied. The recipient can verify the proof without connecting a wallet.')
    } catch { setNotice('Copy failed. Try opening the link and copying the address bar.') }
  }

  function openProof(proof) {
    window.location.assign(proofLink(proof))
  }

  return <section className="poc-share-card">
    <div className="poc-share-title"><div><span className="poc-share-eyebrow">SHAREABLE PROOFS</span><h2>Share a verified transaction</h2><p>A direct link lets anyone check the blockchain proof from their own browser.</p></div><Share2 size={24}/></div>
    <div className="poc-share-list">
      {myProofs.map(({ title, proof }) => <div className="poc-share-entry" key={proof.txHash}>
        <div><strong>{title}</strong><small>My published proof · Portaldot V3</small></div>
        <button type="button" onClick={() => copyProof(proof)}><Copy size={15}/> Copy link</button>
      </div>)}
      <div className="poc-share-entry">
        <div><strong>Public sample proof</strong><small>Block #137579 · Works for visitors with no wallet</small></div>
        <div className="poc-share-actions">
          <button type="button" onClick={() => copyProof(SAMPLE)}><Copy size={15}/> Copy link</button>
          <button type="button" onClick={() => openProof(SAMPLE)}><ExternalLink size={15}/> Try it <ArrowRight size={14}/></button>
        </div>
      </div>
    </div>
    {notice && <p className="poc-share-notice" role="status">{notice}</p>}
    <p className="poc-share-disclaimer">Shared links contain transaction, proof and block references only. Local contribution titles and reviewer approvals are not authenticated by the blockchain.</p>
  </section>
}
