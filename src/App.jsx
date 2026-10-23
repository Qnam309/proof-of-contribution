import { useState } from 'react'
import {
  Activity, ArrowRight, CheckCircle2, ChevronRight, Copy,
  ExternalLink, FileCheck2, FilePlus2, Fingerprint,
  Globe2, LayoutDashboard, Menu, Search, Send, Share2, ShieldCheck, Compass,
  Sparkles, Wallet, X, XCircle
} from 'lucide-react'
import PublishProof from './PublishProof'
import VerifyOnChain from './VerifyOnChain'
import ShareProof from './ShareProof'
import ExploreProofs from './ExploreProofs'
import BlockchainStatus from './BlockchainStatus'
import './App.css'

const STORAGE_KEY = 'poc-contributions-v1'
const PROOF_KEY = 'poc-onchain-proofs-v1'
const SAMPLE = {
  tx: '0x8e84f3871cf90ec6c98d87842ee46f618f4b86c37bbaf38a16e48c658394b27d',
  proof: '0x20ffba48d931940219c5ad726f2dac0487efbd6cd8d197396461a0411b56f116',
  block: 137579
}
const menus = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'submit', label: 'Submit', icon: FilePlus2 },
  { id: 'review', label: 'Review', icon: ShieldCheck },
  { id: 'proofs', label: 'My Proofs', icon: Fingerprint },
  { id: 'explore', label: 'Explore Proofs', icon: Compass },
  { id: 'verify', label: 'Verify', icon: Search },
  { id: 'network', label: 'Network', icon: Activity }
]
function readStorage(key, fallback) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null')
    return data && typeof data === 'object' ? data : fallback
  } catch { return fallback }
}
function compact(value, n = 7) { return value ? `${value.slice(0, n)}...${value.slice(-5)}` : '—' }
function Status({ value }) {
  return <span className={`ui-status ${value === 'Approved' ? 'is-approved' : value === 'Rejected' ? 'is-rejected' : 'is-pending'}`}>{value}</span>
}

export default function App() {
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has('tx') ? 'verify' : 'home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [account, setAccount] = useState('')
  const [accountName, setAccountName] = useState('')
  const [walletStatus, setWalletStatus] = useState('Not connected')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [contributions, setContributions] = useState(() => {
    const items = readStorage(STORAGE_KEY, [])
    return Array.isArray(items) ? items : []
  })
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Community')
  const [description, setDescription] = useState('')
  const [evidence, setEvidence] = useState('')
  const [localId, setLocalId] = useState('')
  const [localResult, setLocalResult] = useState('')

  const mine = contributions.filter(item => account && item.contributor === account)
  const pending = contributions.filter(item => item.status === 'Pending Review')
  const approved = mine.filter(item => item.status === 'Approved')
  const storedProofs = readStorage(PROOF_KEY, {})
  const published = mine.filter(item => !!storedProofs[item.id])

  function go(target) {
    setPage(target)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function connectWallet() {
    setBusy(true)
    setWalletStatus('Connecting...')
    try {
      const provider = window.injectedWeb3?.['portaldot extension']
      if (!provider) throw Error('Portaldot Wallet extension not detected in this browser.')
      const extension = await provider.enable('Proof of Contribution')
      const accounts = await extension.accounts.get()
      if (!accounts?.length) throw Error('No wallet account available. Check website access in the wallet.')
      const chosen = accounts.find(item => item.address.startsWith('5')) || accounts[0]
      setAccount(chosen.address)
      setAccountName(chosen.name || 'Portaldot Account')
      setWalletStatus('Connected')
      setNotice('')
    } catch (error) {
      setWalletStatus(error?.message || 'Connection failed')
      setNotice(error?.message || 'Could not connect wallet')
    } finally { setBusy(false) }
  }
  function disconnect() {
    setAccount(''); setAccountName('')
    setWalletStatus('Disconnected from page')
  }
  function saveItems(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
      setContributions(items)
      return true
    } catch {
      setNotice('Could not save to this browser.')
      return false
    }
  }
  function submit(event) {
    event.preventDefault()
    if (!account) return setNotice('Connect Portaldot Wallet before submitting.')
    if (!title.trim() || !description.trim() || !evidence.trim()) return setNotice('Complete all required fields.')
    let url
    try {
      url = new URL(evidence.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw Error()
    } catch { return setNotice('Evidence must be a valid http:// or https:// link.') }
    const item = {
      id: crypto.randomUUID(), title: title.trim(), category,
      description: description.trim(), evidence: url.href,
      contributor: account, createdAt: new Date().toISOString(),
      status: 'Pending Review', storage: 'Local demo only'
    }
    if (saveItems([item, ...contributions])) {
      setTitle(''); setCategory('Community'); setDescription(''); setEvidence('')
      setNotice('Saved locally. Review is required before publishing on-chain.')
      go('proofs')
    }
  }
  function review(id, status) {
    if (!account) return setNotice('Connect a wallet to review a local demo record.')
    const updated = contributions.map(item => item.id === id && item.status === 'Pending Review'
      ? { ...item, status, reviewedBy: account, reviewedAt: new Date().toISOString() }
      : item)
    if (saveItems(updated)) setNotice(`${status} locally. Reviewer permissions are not yet enforced.`)
  }
  function localVerify(event) {
    event.preventDefault()
    const item = contributions.find(value => value.id === localId.trim())
    setLocalResult(item ? `${item.title}: ${item.status} (browser-only demo)` : 'Record not found in this browser.')
  }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.') }
    catch { setNotice('Clipboard access unavailable.') }
  }

  async function sharePublishedProof(proof) {
    if (!proof?.txHash || !proof?.proofHash || !proof?.blockHash) {
      setNotice('This proof has no complete finalized blockchain reference yet.')
      return
    }
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('tx', proof.txHash)
    url.searchParams.set('proof', proof.proofHash)
    url.searchParams.set('block', proof.blockHash)
    try {
      await navigator.clipboard.writeText(url.toString())
      setNotice('Share Proof link copied. Anyone can verify without connecting a wallet.')
    } catch {
      setNotice('Unable to copy the link. Check clipboard permissions.')
    }
  }

  return page === 'home' ? (
    <div className="ui-site">
      <header className="ui-site-header ui-container">
        <button className="ui-brand" onClick={() => go('home')}><span className="ui-brand-mark">P</span> proof<span className="ui-brand-dot">.</span></button>
        <div className="ui-header-actions"><span className="ui-chain-tag ui-chain-logo"><img src="/portaldot-mark.png" alt="Portaldot"/> PORTALDOT V3 TESTNET</span><button className="ui-btn ui-primary" onClick={() => go('overview')}>Launch App <ArrowRight size={17}/></button></div>
      </header>
      <main>
        <section className="ui-hero ui-container">
          <div className="ui-hero-copy">
            <span className="ui-eyebrow"><Sparkles size={15}/> PROOF OF CONTRIBUTION</span>
            <h1>Every contribution <em>deserves proof.</em></h1>
            <p>Turn meaningful community actions into independently verifiable records on Portaldot V3. Recognize the work. Prove the impact.</p>
            <div className="ui-hero-buttons"><button className="ui-btn ui-primary ui-btn-lg" onClick={() => go('overview')}>Launch App <ArrowRight size={18}/></button><button className="ui-btn ui-outline ui-btn-lg" onClick={() => go('verify')}>Verify a proof <ChevronRight size={18}/></button></div>
            <div className="ui-hero-points"><span><CheckCircle2 size={16}/> Live testnet integration</span><span><Globe2 size={16}/> Open-source MVP</span></div>
          </div>
          <div className="ui-hero-visual"><div className="ui-glow"/><div className="ui-mock-card"><div className="ui-mock-top"><span className="ui-mock-symbol"><ShieldCheck size={27}/></span><span className="ui-mock-verified"><CheckCircle2 size={14}/> VERIFIED</span></div><span className="ui-eyebrow">ON-CHAIN RECORD</span><h2>Proof, not promises.</h2><p>Contribution proof successfully recorded.</p><code>0x20ff...f116</code><div className="ui-mock-bottom"><span><i/> Portaldot V3 Testnet</span><span>Block #{SAMPLE.block}</span></div></div></div>
        </section>
        <section className="ui-how ui-container"><div className="ui-section-top"><span className="ui-eyebrow">THE WORKFLOW</span><h2>One action. One proof.<br/>More possibilities.</h2><p>From evidence submission to a blockchain record anyone can verify.</p></div><div className="ui-step-grid">{[
          {n:'01',icon:FilePlus2,name:'Submit',copy:'Share your contribution and evidence link.'},
          {n:'02',icon:ShieldCheck,name:'Review',copy:'Review the evidence in demo reviewer mode.'},
          {n:'03',icon:Fingerprint,name:'Publish',copy:'Record its SHA-256 hash on Portaldot V3.'},
          {n:'04',icon:Search,name:'Verify',copy:'Independently check the transaction on-chain.'}
        ].map(s => <div className="ui-step" key={s.n}><div className="ui-step-header"><span>{s.n}</span><s.icon size={22}/></div><h3>{s.name}</h3><p>{s.copy}</p></div>)}</div></section>
        <section className="ui-proof-highlight ui-container"><div><span className="ui-eyebrow">REAL TESTNET TRANSACTION</span><h2>Built to be verified.</h2><p>Our first proof was included in Portaldot V3 block #{SAMPLE.block}. Open the app to validate the transaction and its proof hash against blockchain data.</p><button className="ui-btn ui-primary" onClick={() => go('verify')}>Explore verification <ArrowRight size={16}/></button></div><div className="ui-highlight-data"><span className="ui-proof-success"><CheckCircle2 size={16}/> Finalized example</span><small>Transaction</small><code>{compact(SAMPLE.tx, 21)}</code><small>Proof hash</small><code>{compact(SAMPLE.proof, 21)}</code><small>Block</small><strong>#{SAMPLE.block}</strong></div></section>
      </main>
      <footer className="ui-site-footer ui-container"><span>Proof of Contribution · Hacker House 2026</span><a href="https://github.com/Qnam309/proof-of-contribution" target="_blank" rel="noopener noreferrer">View on GitHub <ExternalLink size={14}/></a></footer>
    </div>
  ) : (
    <div className="ui-app">
      <aside className={`ui-sidebar ${menuOpen ? 'ui-sidebar-open' : ''}`}>
        <div className="ui-side-brand"><button className="ui-brand" onClick={() => go('home')}><span className="ui-brand-mark">P</span> proof<span className="ui-brand-dot">.</span></button><button className="ui-mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={19}/></button></div>
        <div className="ui-side-label">WORKSPACE</div>
        <nav className="ui-menu">{menus.map(item => <button key={item.id} className={page === item.id ? 'ui-menu-active' : ''} onClick={() => go(item.id)}><item.icon size={18}/>{item.label}{page === item.id && <span className="ui-menu-dot"/>}</button>)}</nav>
        <div className="ui-side-bottom"><div className="ui-side-chain ui-chain-logo"><img src="/portaldot-mark.png" alt=""/> Portaldot V3 Testnet</div><p>Hacker House 2026<br/><span>Track 4 · Ecosystem DApps</span></p><button onClick={() => go('home')}><Globe2 size={15}/> View website <ArrowRight size={14}/></button></div>
      </aside>
      {menuOpen && <button className="ui-overlay" onClick={() => setMenuOpen(false)} aria-label="Close navigation"/>}
      <div className="ui-main">
        <header className="ui-topbar"><div className="ui-crumb"><button className="ui-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={21}/></button><span>Workspace</span><ChevronRight size={15}/><strong>{menus.find(m => m.id === page)?.label}</strong></div><div className="ui-top-actions"><span className="ui-top-chain ui-chain-logo"><img src="/portaldot-mark.png" alt="Portaldot"/> V3 TESTNET</span><button className="ui-wallet" onClick={connectWallet} disabled={busy}><Wallet size={17}/>{busy ? 'Connecting...' : account ? compact(account, 6) : 'Connect Wallet'}</button></div></header>
        <main className="ui-body">
          {notice && <div className="ui-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Close notification"><X size={17}/></button></div>}
          {page === 'overview' && <>
            <div className="ui-page-title"><div><span className="ui-eyebrow">YOUR WORKSPACE</span><h1>Overview</h1><p>Monitor your contributions and on-chain activity.</p></div><button className="ui-btn ui-primary" onClick={() => go('submit')}><FilePlus2 size={17}/> New contribution</button></div>
            <div className="ui-stats">{[{label:'My contributions',num:mine.length,icon:FileCheck2},{label:'Approved locally',num:approved.length,icon:CheckCircle2},{label:'On-chain proofs',num:published.length,icon:Fingerprint},{label:'Pending review',num:pending.length,icon:Activity}].map(stat => <div className="ui-stat" key={stat.label}><div><span>{stat.label}</span><stat.icon size={19}/></div><strong>{String(stat.num).padStart(2, '0')}</strong><small>Current browser / connected wallet</small></div>)}</div>
            <div className="ui-overview-grid"><section className="ui-panel"><div className="ui-panel-head"><div><h2>Recent contributions</h2><p>Your latest records</p></div><button className="ui-link-button" onClick={() => go('proofs')}>View all <ArrowRight size={15}/></button></div>{!account ? <div className="ui-empty"><Wallet size={26}/><h3>Connect your wallet</h3><p>Contributions appear after connecting your Portaldot account.</p></div> : mine.length === 0 ? <div className="ui-empty"><FilePlus2 size={26}/><h3>No contributions yet</h3><p>Start by submitting your first contribution.</p></div> : <div className="ui-recent-list">{mine.slice(0,5).map(item => <div className="ui-recent" key={item.id}><span className="ui-record-icon"><FileCheck2 size={19}/></span><div><strong>{item.title}</strong><small>{item.category} · {new Date(item.createdAt).toLocaleDateString()}</small></div><Status value={item.status}/></div>)}</div>}</section><section className="ui-panel"><div className="ui-panel-head"><div><h2>Quick actions</h2><p>Continue your workflow</p></div></div><div className="ui-actions-list">{[{id:'submit',icon:FilePlus2,title:'Submit contribution',subtitle:'Add evidence for review'},{id:'review',icon:ShieldCheck,title:'Review queue',subtitle:'Approve demo submissions'},{id:'verify',icon:Search,title:'Verify on-chain',subtitle:'Validate published proofs'}].map(action => <button key={action.id} onClick={() => go(action.id)}><span className="ui-action-icon"><action.icon size={19}/></span><span><strong>{action.title}</strong><small>{action.subtitle}</small></span><ArrowRight size={17}/></button>)}</div></section></div>
            <div className="ui-testnet-banner"><div><span><i/> VERIFIED TESTNET EXAMPLE</span><h3>Proof recorded in block #{SAMPLE.block}</h3><p>Explore independent verification using a finalized Portaldot V3 transaction.</p></div><button className="ui-btn ui-outline" onClick={() => go('verify')}>Open verifier <ArrowRight size={16}/></button></div>
          </>}
          {page === 'submit' && <><div className="ui-page-title"><div><span className="ui-eyebrow">STEP 01 · SUBMIT</span><h1>New contribution</h1><p>Describe your work and provide evidence.</p></div></div><section className="ui-panel ui-form-panel"><div className="ui-panel-head"><div><h2>Contribution details</h2><p>Fields marked * are required.</p></div><FilePlus2 size={21}/></div><form className="ui-form" onSubmit={submit}><label htmlFor="title">Contribution title *</label><input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Portaldot V3 Beginner Guide" maxLength={120} required/><label htmlFor="category">Category *</label><select id="category" value={category} onChange={e => setCategory(e.target.value)}><option>Community</option><option>Education</option><option>Development</option><option>Content</option><option>Other</option></select><label htmlFor="description">Description *</label><textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your contribution..." rows={5} maxLength={2000} required/><label htmlFor="evidence">Evidence URL *</label><input id="evidence" type="url" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="https://..." required/><p className="ui-help">This submission is saved locally. Publishing on-chain happens after demo approval.</p><button className="ui-btn ui-primary" type="submit"><Send size={16}/> Submit Contribution</button></form></section></>}
          {page === 'review' && <><div className="ui-page-title"><div><span className="ui-eyebrow">STEP 02 · REVIEW</span><h1>Review queue</h1><p>Evaluate the evidence provided by contributors.</p></div><span className="ui-count">{pending.length} pending</span></div><div className="ui-info"><ShieldCheck size={20}/> Demo reviewer mode: any connected wallet can approve local records. Reviewer authorization is not yet implemented.</div><section className="ui-panel"><div className="ui-panel-head"><div><h2>Pending submissions</h2><p>Awaiting a demo review decision</p></div></div>{pending.length === 0 ? <div className="ui-empty"><CheckCircle2 size={26}/><h3>All caught up</h3><p>No contributions are currently awaiting review.</p></div> : <div className="ui-record-list">{pending.map(item => <article className="ui-record" key={item.id}><div className="ui-record-head"><span className="ui-record-icon"><FileCheck2 size={20}/></span><div><h3>{item.title}</h3><small>{item.category} · {compact(item.contributor, 12)}</small></div><Status value={item.status}/></div><p>{item.description}</p><div className="ui-record-bottom"><a href={item.evidence} target="_blank" rel="noopener noreferrer">Review evidence <ExternalLink size={14}/></a><div><button className="ui-btn ui-danger" disabled={!account} onClick={() => review(item.id, 'Rejected')}><XCircle size={16}/> Reject</button><button className="ui-btn ui-success" disabled={!account} onClick={() => review(item.id, 'Approved')}><CheckCircle2 size={16}/> Approve</button></div></div></article>)}</div>}</section></>}
          {page === 'proofs' && <><div className="ui-page-title"><div><span className="ui-eyebrow">CONTRIBUTION HISTORY</span><h1>My Proofs</h1><p>Track review status and publish approved proof hashes.</p></div><button className="ui-btn ui-primary" onClick={() => go('submit')}><FilePlus2 size={16}/> New contribution</button></div><section className="ui-panel"><div className="ui-panel-head"><div><h2>Contribution records</h2><p>Stored in this browser for your wallet address</p></div><span className="ui-count">{mine.length} records</span></div>{!account ? <div className="ui-empty"><Wallet size={26}/><h3>Wallet not connected</h3><p>Connect your wallet to view your records.</p></div> : mine.length === 0 ? <div className="ui-empty"><FilePlus2 size={26}/><h3>No records</h3><p>Submit a contribution to start your history.</p></div> : <div className="ui-record-list">{mine.map(item => <article className="ui-record" key={item.id}><div className="ui-record-head"><span className="ui-record-icon"><FileCheck2 size={20}/></span><div><h3>{item.title}</h3><small>{item.category} · {new Date(item.createdAt).toLocaleDateString()}</small></div><Status value={item.status}/></div><p>{item.description}</p><div className="ui-record-bottom"><a href={item.evidence} target="_blank" rel="noopener noreferrer">Evidence <ExternalLink size={14}/></a><button className="ui-link-button" onClick={() => copy(item.id)}><Copy size={14}/> Copy record ID</button></div>{storedProofs[item.id] && <div className="ui-onchain-proof-panel">
  <div className="ui-onchain-proof-head"><CheckCircle2 size={17}/><strong>Published on Portaldot V3</strong><span>On-chain</span></div>
  <p>Transaction: <code>{compact(storedProofs[item.id].txHash, 18)}</code></p>
  <div className="ui-onchain-proof-actions"><button type="button" className="ui-btn ui-primary" onClick={() => sharePublishedProof(storedProofs[item.id])}><Share2 size={16}/> Share Proof</button><button type="button" className="ui-btn ui-outline" onClick={() => go('verify')}><Search size={16}/> Verify on-chain</button></div>
</div>}</article>)}</div>}</section><div className="ui-integrated"><PublishProof account={account} contributions={contributions}/></div></>}
          {page === 'explore' && <ExploreProofs onVerify={() => go('verify')} />}
          {page === 'verify' && <><div className="ui-page-title"><div><span className="ui-eyebrow">TRUST, BUT VERIFY</span><h1>Verify proof</h1><p>Check a contribution proof against Portaldot V3 blockchain data.</p></div></div><div className="ui-info"><ShieldCheck size={20}/> Verification checks transaction inclusion and successful execution, not the quality of a contribution or the reviewer's authority.</div><ShareProof account={account} contributions={contributions}/><div className="ui-integrated"><VerifyOnChain/></div><section className="ui-panel ui-local"><div className="ui-panel-head"><div><h2>Local record lookup</h2><p>Optional browser-only demo status check</p></div></div><form className="ui-form" onSubmit={localVerify}><label htmlFor="local-id">Local record ID</label><input id="local-id" value={localId} onChange={e => setLocalId(e.target.value)} placeholder="Paste record ID" required/><button className="ui-btn ui-outline" type="submit"><Search size={16}/> Check local status</button></form>{localResult && <p className="ui-help">{localResult}</p>}</section></>}
          {page === 'network' && <><div className="ui-page-title"><div><span className="ui-eyebrow">LIVE INFRASTRUCTURE</span><h1>Network status</h1><p>Read-only blockchain data from Portaldot V3 Testnet.</p></div></div><section className="ui-panel"><div className="ui-panel-head"><div><h2>Wallet connection</h2><p>Portaldot native extension</p></div><Wallet size={21}/></div><div className="ui-wallet-info"><div><span>Account</span><strong>{accountName || 'Not connected'}</strong></div><div><span>Address</span><strong>{account || '—'}</strong></div><div><span>Status</span><strong>{walletStatus}</strong></div></div><div className="ui-wallet-actions">{account ? <><button className="ui-btn ui-outline" onClick={() => copy(account)}><Copy size={15}/> Copy address</button><button className="ui-btn ui-text" onClick={disconnect}>Disconnect</button></> : <button className="ui-btn ui-primary" onClick={connectWallet} disabled={busy}><Wallet size={16}/> Connect wallet</button>}</div></section><div className="ui-integrated"><BlockchainStatus account={account}/></div></>}
          <footer className="ui-app-footer"><span>Proof of Contribution · Portaldot Hacker House 2026</span><span>Testnet MVP</span></footer>
        </main>
      </div>
    </div>
  )
}
