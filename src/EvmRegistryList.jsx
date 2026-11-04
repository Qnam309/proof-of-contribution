import { useEffect, useRef, useState } from 'react'
import { registryClient as client, registryAbi as abi, registryAddress as contract, statusName, parseProofEvidence, resolveProofEvidence } from './EvmRegistryShared'

const PAGE_SIZE = 15n
const short = (s) => s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const normalizeUrl = value => {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch { return null }
}
const matchesTerm = (row, metadata, term, urlTerm) => {
  const fields = [String(row.id), row.contributor, row.reviewer, row.contentHash,
    metadata?.title, metadata?.description, metadata?.category, metadata?.evidenceUrl]
  if (urlTerm) return normalizeUrl(metadata?.evidenceUrl || '') === urlTerm
  return fields.some(value => String(value || '').toLowerCase().includes(term))
}

export default function EvmRegistryList({ account, walletKind, mine = false, onVerify, onExplore, onConnectWallet }) {
  const [rows, setRows] = useState([])
  const [metadataMap, setMetadataMap] = useState({})
  const [cursor, setCursor] = useState(null)
  const [latest, setLatest] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scanned, setScanned] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [copyNotice, setCopyNotice] = useState('')
  const [nativeAnchors, setNativeAnchors] = useState([])
  const [nativeIndexWarning, setNativeIndexWarning] = useState('')
  const [registryResults, setRegistryResults] = useState(null)
  const [registryProgress, setRegistryProgress] = useState({ checked: 0, total: 0, failed: 0 })
  const [registryRunning, setRegistryRunning] = useState(false)
  const [registryMessage, setRegistryMessage] = useState('')
  const scanToken = useRef(0)
  const filtered = mine
  const canFilter = !!account && ['metamask', 'okx'].includes(walletKind)

  // Hints only: the Unified Verify page always rechecks both chains.
  // Prefer the durable Blob index API, with the static public manifest as fallback.
  useEffect(() => {
    let cancelled = false
    const isValid = a => /^[1-9]\d*$/.test(String(a.contributionId)) &&
      /^0x[0-9a-fA-F]{64}$/.test(a.contentHash || '') &&
      /^0x[0-9a-fA-F]{64}$/.test(a.nativeTx || '') &&
      (/^0x[0-9a-fA-F]{64}$/.test(String(a.nativeBlock || '')) || /^[1-9]\d*$/.test(String(a.nativeBlock || '')))
    async function readIndex() {
      let publicAnchors = []
      let apiAnchors = []
      const warnings = []
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}native-anchors.json`, { cache: 'no-store' })
        if (!response.ok) throw Error(`HTTP ${response.status}`)
        publicAnchors = (await response.json()).anchors || []
      } catch (error) { warnings.push(`Static anchor manifest: ${error.message}`) }
      try {
        const response = await fetch('/api/native-anchors', { cache: 'no-store' })
        if (!response.ok) throw Error(`HTTP ${response.status}`)
        const payload = await response.json()
        if (!Array.isArray(payload.anchors)) throw Error('Invalid API index')
        apiAnchors = payload.anchors
      } catch (error) { warnings.push(`Live anchor index unavailable: ${error.message}`) }
      const all = [...apiAnchors, ...publicAnchors].filter(isValid)
      const seen = new Set()
      const unique = all.filter(a => {
        const key = `${a.contributionId}:${a.nativeTx.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (!cancelled) {
        setNativeAnchors(unique)
        setNativeIndexWarning(warnings.join(' · '))
      }
    }
    readIndex()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    scanToken.current += 1
    setRegistryRunning(false); setRegistryResults(null); setRegistryMessage('')
    setRows([]); setMetadataMap({}); setCursor(null); setLatest(null); setError(''); setScanned(0)
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
      if (reset) setMetadataMap({})
      // Fetch external metadata asynchronously: a broken remote URL never masquerades as verified.
      visible.filter(item => !item.readError && item.evidenceURI?.startsWith('poc:ext:v1:')).forEach(item => {
        resolveProofEvidence(item.evidenceURI, item.contentHash)
          .then(metadata => setMetadataMap(old => ({ ...old, [String(item.id)]: { metadata } })))
          .catch(e => setMetadataMap(old => ({ ...old, [String(item.id)]: { error: e.message } })))
      })
      setCursor(end - 1n)
      setScanned(n => reset ? ids.length : n + ids.length)
      if (nextId !== null) setLatest(nextId)
      const failures = found.filter(r => r.readError).length
      if (failures) setError(`${failures} record(s) could not be read. Try again later.`)
    } catch (e) { setError(e.shortMessage || e.message) }
    finally { setLoading(false) }
  }

  // Explicit full-registry lookup. One RPC request at a time to respect testnet rate limits.
  // Metadata is hash-checked by resolveProofEvidence before it can become a search hit.
  async function searchRegistry() {
    const term = search.trim().toLowerCase()
    if (!term || registryRunning || loading) return
    const urlTerm = normalizeUrl(search)
    const token = ++scanToken.current
    setRegistryRunning(true)
    setRegistryResults([])
    setRegistryMessage('')
    setRegistryProgress({ checked: 0, total: 0, failed: 0 })
    try {
      const nextId = await client.readContract({ address: contract, abi, functionName: 'nextId' })
      const total = Number(nextId - 1n)
      if (!Number.isSafeInteger(total) || total < 0) throw Error('Registry size is too large for browser lookup.')
      setRegistryProgress({ checked: 0, total, failed: 0 })
      let failed = 0
      let found = []
      for (let id = total; id >= 1; id--) {
        if (scanToken.current !== token) return
        try {
          const entry = await client.readContract({ address: contract, abi, functionName: 'getContribution', args: [BigInt(id)] })
          const row = { id: BigInt(id), ...entry }
          let metadata = null
          if (row.evidenceURI?.startsWith('poc:ext:v1:')) {
            try { metadata = await resolveProofEvidence(row.evidenceURI, row.contentHash) }
            catch { failed++ }
          } else {
            try { metadata = parseProofEvidence(row.evidenceURI) }
            catch { failed++ }
          }
          if (metadata && matchesTerm(row, metadata, term, urlTerm) &&
              (statusFilter === 'all' || statusName(row.status) === statusFilter)) {
            found.push(row)
            setMetadataMap(old => ({ ...old, [String(id)]: { metadata } }))
            setRegistryResults([...found])
          } else if (!urlTerm && matchesTerm(row, metadata, term, null) &&
              (statusFilter === 'all' || statusName(row.status) === statusFilter)) {
            // ID/address/hash lookup does not require external metadata to load.
            found.push(row)
            setMetadataMap(old => ({ ...old, [String(id)]: metadata ? { metadata } : { error: 'Metadata could not be verified' } }))
            setRegistryResults([...found])
          }
        } catch { failed++ }
        if (scanToken.current !== token) return
        setRegistryProgress({ checked: total - id + 1, total, failed })
        if (id > 1) await pause(350)
      }
      setRegistryMessage(failed
        ? `Search completed with ${failed} unreadable or unverified record(s); results may be incomplete.`
        : `Search complete. Checked all ${total} on-chain contribution(s).`)
    } catch (e) {
      if (scanToken.current === token) setRegistryMessage(`Search interrupted: ${e.shortMessage || e.message}. Results may be incomplete.`)
    } finally {
      if (scanToken.current === token) setRegistryRunning(false)
    }
  }

  function cancelRegistrySearch() {
    scanToken.current += 1
    setRegistryRunning(false)
    setRegistryMessage('Search stopped. Partial results only.')
  }

  const searchAllActive = !mine && registryResults !== null
  const displayed = rows.filter(row => {
    if (row.readError) return false
    if (statusFilter !== 'all' && statusName(row.status) !== statusFilter) return false
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return [String(row.id), row.contributor, row.reviewer, row.evidenceURI, row.contentHash, metadataMap[String(row.id)]?.metadata?.title, metadataMap[String(row.id)]?.metadata?.description, metadataMap[String(row.id)]?.metadata?.evidenceUrl]
      .some(value => String(value || '').toLowerCase().includes(needle))
  })
  const visibleRows = searchAllActive ? registryResults : displayed
  function nativeAnchorFor(row) {
    // Require exact Contribution ID AND recorded EVM contentHash match.
    // A stale or malicious index cannot silently attach a native proof to another record.
    return nativeAnchors.find(anchor =>
      String(anchor.contributionId) === String(row.id) &&
      anchor.contentHash.toLowerCase() === String(row.contentHash).toLowerCase()
    ) || null
  }
  function linkForRow(row, unified = false) {
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('contribution', String(row.id))
    const anchor = unified ? nativeAnchorFor(row) : null
    if (anchor) {
      url.searchParams.set('nativeTx', anchor.nativeTx)
      url.searchParams.set('nativeBlock', String(anchor.nativeBlock))
    }
    return url.toString()
  }
  async function shareUnified(row) {
    const anchor = nativeAnchorFor(row)
    if (!anchor) { setCopyNotice('No indexed Native Anchor for this contribution. Share the EVM proof instead.'); return }
    try {
      await navigator.clipboard.writeText(linkForRow(row, true))
      setCopyNotice(`Unified proof link for contribution #${row.id} copied. The recipient verifies both chains on opening.`)
    } catch { setCopyNotice('Could not copy the link; check clipboard permissions.') }
  }
  function openUnified(row) {
    const anchor = nativeAnchorFor(row)
    if (!anchor) return
    window.location.assign(linkForRow(row, true))
  }
  async function shareRecord(row) {
    // Regular proof links remain EVM-only; Unified links are offered separately.
    try { await navigator.clipboard.writeText(linkForRow(row)); setCopyNotice(`Link to contribution #${row.id} copied.`) }
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
        <input aria-label="Search loaded contributions" value={search} onChange={e => { setSearch(e.target.value); setRegistryResults(null); setRegistryMessage(''); scanToken.current += 1; setRegistryRunning(false) }} placeholder={mine ? 'Search loaded ID, address, or title' : 'Paste evidence URL, title, ID, or wallet'} />
        <select aria-label="Filter loaded contributions by status" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setRegistryResults(null); setRegistryMessage(''); scanToken.current += 1; setRegistryRunning(false) }}>
          <option value="all">All statuses</option><option value="Pending Review">Pending Review</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option>
        </select>
      </div>}
      <p className="ui-help">{mine ? 'Filters search records already loaded below. Use “Load older” to include earlier records.' : 'Quick filter checks loaded records. For an evidence URL or keyword anywhere on-chain, use Search entire registry.'}</p>
      {!mine && <div className="poc-search-actions">
        <button className="ui-btn ui-primary" type="button" disabled={registryRunning || loading || !search.trim()} onClick={searchRegistry}>{registryRunning ? 'Searching registry...' : 'Search entire registry'}</button>
        {registryRunning && <button className="ui-btn ui-outline" type="button" onClick={cancelRegistrySearch}>Stop search</button>}
        {searchAllActive && !registryRunning && <button className="ui-btn ui-outline" type="button" onClick={() => { setRegistryResults(null); setRegistryMessage('') }}>Back to loaded records</button>}
      </div>}
      {searchAllActive && <p className="ui-help" role="status">Registry scan: {registryProgress.checked} / {registryProgress.total} · Matches: {registryResults.length}{registryProgress.failed ? ` · Unreadable/unverified: ${registryProgress.failed}` : ''}</p>}
      {registryMessage && <p className="ui-help" role="status">{registryMessage}</p>}
      <button className="ui-btn ui-outline" type="button" disabled={loading || registryRunning || (filtered && !canFilter)} onClick={() => loadMore(true)}>{loading ? 'Loading...' : 'Refresh from V3 (free)'}</button>
      {latest !== null && <p className="ui-help">On-chain contributions: {String(latest - 1n)} · Scanned: {scanned} · Displayed: {rows.length}{filtered ? ' · Load older to search further back' : ''}</p>}
      {error && <p role="alert" className="ui-help" style={{ color: '#f3acac' }}>{error}</p>}
      {rows.length === 0 && !loading && latest !== null && <p className="ui-help">No matching contributions in the loaded range. You can load older records below.</p>}
      {!mine && <p className="ui-help">Native Anchor discovery combines the public example manifest with the live on-chain-validated registry when available. Every shared Unified Proof checks both chains again.</p>}
      {!mine && nativeIndexWarning && <p className="ui-help" role="status">{nativeIndexWarning} EVM verification remains available.</p>}
      {copyNotice && <p className="ui-help" role="status">{copyNotice}</p>}
      <div className="ui-record-list">
        {visibleRows.map(row => { const resolved = metadataMap[String(row.id)]; const external = row.evidenceURI?.startsWith('poc:ext:v1:'); const meta = resolved?.metadata || (external ? null : parseProofEvidence(row.evidenceURI)); return <article key={String(row.id)} className="ui-record">
          <div className="ui-record-head"><div><h3>{meta?.title || `Contribution #${String(row.id)}`}</h3><small>Contribution #{String(row.id)} · {meta?.category || 'Legacy proof'} · {short(row.contributor)}</small></div><strong>{statusName(row.status)}</strong></div>
          {meta?.description && <p>{meta?.description}</p>}
          <p style={{ overflowWrap: 'anywhere' }}>Evidence: <a href={/^https?:\/\//i.test(meta?.evidenceUrl) ? meta?.evidenceUrl : '#'} target="_blank" rel="noopener noreferrer">{meta?.evidenceUrl || 'Invalid evidence metadata'}</a></p>
          {external && <p className="ui-help" role="status" style={{ color: resolved?.error ? '#f3acac' : '#83e6b6' }}>{resolved?.error ? `External metadata NOT VERIFIED: ${resolved.error}` : resolved?.metadata ? 'External metadata integrity: VERIFIED against on-chain SHA-256' : 'Checking external metadata integrity...'}</p>}
          <p className="ui-help" style={{ overflowWrap: 'anywhere' }}>Hash: {row.contentHash}<br/>Reviewer: {row.reviewer}<br/>Contributor: {row.contributor}</p>
          <div className="poc-timeline" aria-label="Contribution lifecycle">
            <span className="done">Submitted</span><span className="done">Under review</span>
            <span className={Number(row.status) === 1 ? '' : 'done'}>{statusName(row.status) === 'Pending Review' ? 'Awaiting decision' : statusName(row.status)}</span>
            {Number(row.status) === 2 && <span className="done">Ready to verify</span>}
          </div>
          {nativeAnchorFor(row) && <p className="ui-help" style={{ color: '#83e6b6' }}>Native Anchor indexed · Open Unified Proof to verify Native block and EVM hash live.</p>}
          <div className="poc-inline-actions">
            <button className="ui-btn ui-outline" type="button" onClick={() => shareRecord(row)}>Copy EVM proof link</button>
            {nativeAnchorFor(row) && <button className="ui-btn ui-primary" type="button" onClick={() => shareUnified(row)}>Copy Unified Proof link</button>}
            {nativeAnchorFor(row) && <button className="ui-btn ui-outline" type="button" onClick={() => openUnified(row)}>Open Unified Verify</button>}
            {onVerify && <button className="ui-btn ui-outline" type="button" onClick={() => onVerify(row)}>Open Verifier</button>}
          </div>
        </article> })}
      </div>
      {searchAllActive && !registryRunning && registryResults.length === 0 && <p className="ui-help">No matching contributions found.</p>}
      {!searchAllActive && cursor !== null && cursor > 0n && <button className="ui-btn ui-outline" type="button" disabled={loading} onClick={() => loadMore(false)}>Load 15 older records (free)</button>}
    </div>
  </section>
}
