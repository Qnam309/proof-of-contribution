import { useMemo, useState } from 'react'
import { CheckCircle2, Compass, ExternalLink, FileCheck2, Search, ShieldCheck, ArrowRight } from 'lucide-react'

// Public on-chain example already submitted and verified on Portaldot V3.
// Future demo entries should be added separately and clearly marked as DEMO ONLY.
const VERIFIED_EXAMPLES = [
  {
    id: 'v3-beginner-guide',
    title: 'Portaldot V3 Beginner Guide',
    category: 'Education',
    description: 'A beginner-friendly guide explaining wallet connection and how to explore the Portaldot V3 testnet.',
    block: 137579,
    transaction: '0x8e84f3871cf90ec6c98d87842ee46f618f4b86c37bbaf38a16e48c658394b27d',
    proof: '0x20ffba48d931940219c5ad726f2dac0487efbd6cd8d197396461a0411b56f116',
    status: 'On-chain transaction',
  },
]

function shorten(hash) { return `${hash.slice(0, 15)}...${hash.slice(-10)}` }

export default function ExploreProofs({ onVerify }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All categories')
  const [copied, setCopied] = useState(false)
  const examples = useMemo(() => VERIFIED_EXAMPLES.filter((item) =>
    (category === 'All categories' || category === item.category) &&
    `${item.title} ${item.category} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim())
  ), [search, category])

  async function share(item) {
    // Public verification link works for visitors who have never connected a wallet.
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('tx', item.transaction)
    url.searchParams.set('proof', item.proof)
    url.searchParams.set('block', String(item.block))
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this verification link:', url.toString())
    }
  }

  return <>
    <div className="ui-page-title">
      <div><span className="ui-eyebrow">PUBLIC PROOF GALLERY</span><h1>Explore Proofs</h1><p>Discover published contributions and independently verify on-chain records.</p></div>
      <span className="ui-count">{VERIFIED_EXAMPLES.length} public proof</span>
    </div>
    <div className="ui-info"><ShieldCheck size={20}/> This gallery currently shows one real testnet transaction. The blockchain verifies the published hash, not the contribution's authenticity or reviewer authority.</div>
    <section className="ui-panel ui-explore-panel">
      <div className="ui-panel-head"><div><h2>Discover contributions</h2><p>Browse public examples · no wallet needed</p></div><Compass size={20}/></div>
      <div className="ui-explore-toolbar">
        <div className="ui-explore-search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contributions..." aria-label="Search contributions"/></div>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category"><option>All categories</option><option>Education</option><option>Community</option><option>Content</option><option>Development</option></select>
      </div>
      <div className="ui-explore-grid">
        {examples.map(item => <article className="ui-explore-card" key={item.id}>
          <div className="ui-explore-card-top"><span className="ui-explore-card-icon"><FileCheck2 size={20}/></span><span className="ui-explore-status"><CheckCircle2 size={14}/> ON-CHAIN</span></div>
          <span className="ui-explore-category">{item.category} · Portaldot V3 Testnet</span>
          <h3>{item.title}</h3><p>{item.description}</p>
          <div className="ui-explore-details"><span>Block <strong>#{item.block}</strong></span><span title={item.transaction}>Tx <code>{shorten(item.transaction)}</code></span></div>
          <div className="ui-explore-buttons">
            <button className="ui-btn ui-primary" onClick={onVerify}><Search size={16}/> Verify on-chain <ArrowRight size={15}/></button>
            <button className="ui-btn ui-outline" onClick={() => share(item)}><ExternalLink size={15}/> {copied ? 'Link copied!' : 'Share link'}</button>
          </div>
        </article>)}
        {examples.length === 0 && <div className="ui-explore-empty"><Search size={24}/><h3>No matching proofs</h3><p>Try another category or keyword. More verified examples can be added later.</p></div>}
      </div>
    </section>
    <p className="ui-explore-disclaimer">Additional example records will be added after this page is tested. Local demo approvals are not public blockchain attestations.</p>
  </>
}
