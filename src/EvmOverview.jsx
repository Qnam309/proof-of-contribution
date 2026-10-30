import { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, FileCheck2, ShieldCheck } from 'lucide-react'
import { registryClient as client, registryAbi as abi, registryAddress as contract, statusName, parseProofEvidence, resolveProofEvidence } from './EvmRegistryShared'

const knownReviewer = '0xf51e2695aB684496E902Ba30911318A2644bD344'
const LIMIT = 300n
export default function EvmOverview({ onSubmit, onExplore, onVerify }) {
  const [data, setData] = useState(null)
  const [metadata, setMetadata] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function refresh() {
    setLoading(true); setError('')
    try {
      const nextId = await client.readContract({address: contract,abi,functionName:'nextId'})
      const total = nextId - 1n
      const end = total > LIMIT ? total - LIMIT + 1n : 1n
      const ids = []
      for (let id = total; id >= end; id--) ids.push(id)
      const results = await Promise.all(ids.map(async id => ({ id, record: await client.readContract({address:contract,abi,functionName:'getContribution',args:[id]}) })))
      const approved = results.filter(r => Number(r.record.status) === 2).length
      const pending = results.filter(r => Number(r.record.status) === 1).length
      const reviewerActive = await client.readContract({address:contract,abi,functionName:'reviewers',args:[knownReviewer]})
      setMetadata({})
      results.slice(0, 5).filter(r => r.record.evidenceURI?.startsWith('poc:ext:v1:')).forEach(r => { resolveProofEvidence(r.record.evidenceURI, r.record.contentHash).then(info => setMetadata(old => ({ ...old, [String(r.id)]: info.title }))).catch(() => setMetadata(old => ({ ...old, [String(r.id)]: 'External metadata unavailable or hash mismatch' }))) })
      setData({total:total.toString(), approved, pending, recent:results.slice(0,5), scanned:ids.length, limited:total > LIMIT, reviewerActive})
    } catch(e) { setData(null); setError(e.shortMessage || e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  const cards = [
    {title:'Total contributions',value:data?.total, icon:FileCheck2},
    {title:'Approved',value:data?.approved,icon:CheckCircle2},
    {title:'Pending review',value:data?.pending,icon:Clock3},
    {title:'Known authorized reviewers',value:data ? Number(data.reviewerActive) : null,icon:ShieldCheck}
  ]
  return <div className="poc-overview">
    <div className="poc-dashboard-actions"><span className="poc-live-tag">Live registry · Chain 420420777</span><button className="ui-btn ui-outline" disabled={loading} onClick={refresh}>{loading?'Loading V3…':'Refresh live data'}</button></div>
    {error && <p role="alert" className="poc-error">Unable to load live data: {error}</p>}
    <div className="poc-kpi-grid">{cards.map(k => <div className="poc-kpi" key={k.title}><div className="poc-kpi-label"><span>{k.title}</span><k.icon size={18}/></div><strong>{k.value === null || k.value === undefined ? '—' : k.value}</strong><small>{k.title.includes('reviewer') ? 'Known address only, not a network-wide total' : data?.limited && k.title !== 'Total contributions' ? `Among latest ${data.scanned} records` : 'Portaldot V3 EVM'}</small></div>)}</div>
    <section className="ui-panel poc-panel-unified"><div className="ui-panel-head"><div><h2>Recent on-chain contributions</h2><p>Read directly from the deployed ContributionRegistry contract</p></div><button className="ui-btn ui-outline" onClick={onExplore}>Explore all</button></div>
      {!data && !error && <p className="poc-panel-message">Loading live V3 data…</p>}
      {data?.recent.length === 0 && <p className="poc-panel-message">No contributions on V3 yet.</p>}
      {data?.recent.map(({id,record})=><div className="poc-recent-row" key={String(id)}><div><strong>Contribution #{String(id)}</strong><small>{metadata[String(id)] || parseProofEvidence(record.evidenceURI).title || parseProofEvidence(record.evidenceURI).evidenceUrl || 'No evidence URI'}</small></div><span className="poc-status-chip">{statusName(record.status)}</span></div>)}
      <div className="poc-panel-actions"><button className="ui-btn ui-primary" onClick={onSubmit}>Submit contribution</button><button className="ui-btn ui-outline" onClick={onVerify}>Verify proof</button></div>
    </section>
    <p className="poc-footnote">Approved and pending totals are calculated from on-chain records{data?.limited ? ` (latest ${LIMIT} records only)` : ''}. Reviewer count covers only the known reviewer address until a full index is available. Demo records are never included.</p>
  </div>
}
