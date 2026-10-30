import { useEffect, useState } from 'react'
import { registryClient as client, registryAbi as abi, registryAddress as contract, statusName } from './EvmRegistryShared'

const PAGE_SIZE = 15n
const short = (s) => s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—'

export default function EvmRegistryList({ account, walletKind, mine = false, onVerify, onExplore, onConnectWallet }) {
  const [rows, setRows] = useState([])
  const [cursor, setCursor] = useState(null)
  const [latest, setLatest] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scanned, setScanned] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [copyNotice, setCopyNotice] = useState('')
  const filtered = mine
  const canFilter = !!account && ['metamask', 'okx'].includes(walletKind)

  useEffect(() => {
    setRows([]); setCursor(null); setLatest(null); setError(''); setScanned(0)
  }, [account, walletKind, mine])

  async function loadMore(reset = false) {
    if (loading) return
    if (filtered && !canFilter) { setError('Connect MetaMask or OKX Wallet to see contributions associated with your EVM address.'); return }
    setLoading(true); setError('')
    try {
      const nextId = reset || cursor === null
        ? await client.readContract({ address: contract, abi, functionName: 'nextId' })
        : null
      const beginning = nextId === null ? cursor : nextId - 1n
      if (beginning < 1n) {
        if (reset) setRows([])
        setCursor(0n); setLatest(nextId ?? latest)
        return
      }
      const end = beginning > PAGE_SIZE ? beginning - PAGE_SIZE + 1n : 1n
      const ids = []
      for (let id = beginning; id >= end; id--) ids.push(id)
      const found = await Promise.all(ids.map(async id => {
        try {
          const entry = await client.readContract({ address: contract, abi, functionName: 'getContribution', args: [id] })
          return { id, ...entry }
        } catch (e) { return { id, readError: e.shortMessage || e.message } }
      }))
      const visible = found.filter(item => !filtered || (item.contributor && item.contributor.toLowerCase() === account.toLowerCase()))
      setRows(previous => reset ? visible : [...previous, ...visible])
      setCursor(end - 1n)
      setScanned(n => reset ? ids.length : n + ids.length)
      if (nextId !== null) setLatest(nextId)
      const failures = found.filter(r => r.readError).length
      if (failures) setError(`${failures} record(s) could not be read. Try again later.`)
    } catch (e) { setError(e.shortMessage || e.message) }
    finally { setLoading(false) }
  }

  const displayed = rows.filter(row => {
    if (row.readError) return false
    if (statusFilter !== 'all' && statusName(row.status) !== statusFilter) return false
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return [String(row.id), row.contributor, row.reviewer, row.evidenceURI, row.contentHash]
      .some(value => String(value || '').toLowerCase().includes(needle))
  })
  async function shareRecord(row) {
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('contribution', String(row.id))
    url.searchParams.set('evidence', row.evidenceURI || '')
    try { await navigator.clipboard.writeText(url.toString()); setCopyNotice(`Link to contribution #${row.id} copied.`) }
    catch { setCopyNotice('Could not copy the link; check clipboard permissions.') }
  }
  return <section className="ui-panel ui-form-panel" style={{ marginTop: 22 }}>
    <div className="ui-panel-head"><div>
      <h2>{mine ? 'My EVM On-chain Contributions' : 'Explore EVM On-chain Contributions'}</h2>
      <p>Read-only, live data from ContributionRegistry on Portaldot V3 Testnet. No wallet signature or POT required.</p>
    </div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      {filtered && <p className="ui-help">Showing records belonging to {canFilter ? account : 'your connected EVM wallet'}. Native Portaldot accounts cannot be matched to an EVM contributor address.</p>}
      {filtered && !canFilter && <div className="poc-wallet-empty" role="status">
        <strong>Connect your EVM wallet to view My Proofs</strong>
        <p>MetaMask or OKX identifies which on-chain contributions belong to you. The registry is public, and you can explore it without connecting.</p>
        <div className="poc-panel-actions">
          <button className="ui-btn ui-primary" type="button" onClick={onConnectWallet}>Connect Wallet</button>
          <button className="ui-btn ui-outline" type="button" onClick={onExplore}>Explore all contributions</button>
        </div>
      </div>}
      {(!filtered || canFilter) && <div className="poc-filter-row">
        <input aria-label="Search loaded contributions" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loaded ID, address, URL, hash" />
        <select aria-label="Filter loaded contributions by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option><option value="Pending Review">Pending Review</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option>
        </select>
      </div>}
      <p className="ui-help">Filters search records already loaded below. Use “Load older” to include earlier records.</p>
      <button className="ui-btn ui-outline" type="button" disabled={loading || (filtered && !canFilter)} onClick={() => loadMore(true)}>{loading ? 'Loading...' : 'Refresh from V3 (free)'}</button>
      {latest !== null && <p className="ui-help">On-chain contributions: {String(latest - 1n)} · Scanned: {scanned} · Displayed: {rows.length}{filtered ? ' · Load older to search further back' : ''}</p>}
      {error && <p role="alert" className="ui-help" style={{ color: '#f3acac' }}>{error}</p>}
      {rows.length === 0 && !loading && latest !== null && <p className="ui-help">No matching contributions in the loaded range. You can load older records below.</p>}
      {copyNotice && <p className="ui-help" role="status">{copyNotice}</p>}
      <div className="ui-record-list">
        {displayed.map(row => <article key={String(row.id)} className="ui-record">
          <div className="ui-record-head"><div><h3>Contribution #{String(row.id)}</h3><small>EVM V3 · {short(row.contributor)}</small></div><strong>{statusName(row.status)}</strong></div>
          <p style={{ overflowWrap: 'anywhere' }}>Evidence: <a href={/^https?:\/\//i.test(row.evidenceURI) ? row.evidenceURI : '#'} target="_blank" rel="noopener noreferrer">{row.evidenceURI}</a></p>
          <p className="ui-help" style={{ overflowWrap: 'anywhere' }}>Hash: {row.contentHash}<br/>Reviewer: {row.reviewer}<br/>Contributor: {row.contributor}</p>
          <div className="poc-timeline" aria-label="Contribution lifecycle">
            <span className="done">Submitted</span><span className="done">Under review</span>
            <span className={Number(row.status) === 1 ? '' : 'done'}>{statusName(row.status) === 'Pending Review' ? 'Awaiting decision' : statusName(row.status)}</span>
            {Number(row.status) === 2 && <span className="done">Ready to verify</span>}
          </div>
          <div className="poc-inline-actions">
            <button className="ui-btn ui-outline" type="button" onClick={() => shareRecord(row)}>Copy proof link</button>
            {onVerify && <button className="ui-btn ui-outline" type="button" onClick={() => onVerify(row)}>Open Verifier</button>}
          </div>
        </article>)}
      </div>
      {cursor !== null && cursor > 0n && <button className="ui-btn ui-outline" type="button" disabled={loading} onClick={() => loadMore(false)}>Load 15 older records (free)</button>}
      <p className="ui-help">Records are fetched from the blockchain, not the browser's demo storage. This list loads in pages to avoid overwhelming the RPC.</p>
    </div>
  </section>
}
