import { useState } from 'react'
import { registryAbi as abi, registryAddress as contract, registryClient as client, loadContribution, statusName, resolveProofEvidence } from './EvmRegistryShared'

const box = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: 12 }

export default function EvmVerifyPanel() {
  const [idText, setIdText] = useState(() => new URLSearchParams(window.location.search).get('contribution') || '1')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('Enter a Contribution ID to verify the exact registered on-chain evidence (free).')

  async function verify() {
    setBusy(true)
    try {
      if (!/^[1-9]\d*$/.test(idText.trim())) throw Error('Enter a positive numeric Contribution ID.')
      const id = BigInt(idText.trim())
      const contribution = await loadContribution(id)
      const metadata = await resolveProofEvidence(contribution.evidenceURI, contribution.contentHash)
      const contentHash = metadata.hash
      const verified = await client.readContract({
        address: contract, abi, functionName: 'verifyContribution', args: [id, contentHash]
      })
      const matchesURI = metadata.integrityVerified
      setResult(`Contribution #${id}\nStatus: ${statusName(contribution.status)}\nContributor: ${contribution.contributor}\nReviewer: ${contribution.reviewer}\nTitle: ${metadata.title || 'Legacy URL proof'}\nCategory: ${metadata.category || '—'}\nDescription: ${metadata.description || '—'}\nEvidence URL: ${metadata.evidenceUrl}\nRecorded content hash: ${contribution.contentHash}\nComputed evidence SHA-256: ${contentHash}\nComputed SHA-256 matches stored hash: ${matchesURI ? 'YES' : 'NO'}\nMetadata storage: ${metadata.isExternal ? `External JSON (${metadata.metadataUrl})` : "On-chain legacy format"}\nExternal metadata integrity: ${metadata.integrityVerified ? "VERIFIED" : "FAILED"}\nContract verifyContribution: ${verified}\n\n${verified && matchesURI && Number(contribution.status) === 2 ? 'VERIFIED: APPROVED ON-CHAIN' : 'NOT VERIFIED AS APPROVED FOR THIS EVIDENCE'}\n\nRead-only check — no transaction sent or POT spent.`)
    } catch (e) { setResult('Verification failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  return <section className="ui-panel ui-form-panel" style={{ marginTop: 22 }}>
    <div className="ui-panel-head"><div><h2>EVM Registry Verification</h2><p>Independently verify approved contributions against ContributionRegistry on V3.</p></div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      <p className="ui-help">No wallet or gas needed. Reads the exact evidence data from V3, hashes it independently, and calls the deployed contract's verifyContribution. Supports both older URL-only and newer full-detail and external-JSON records.</p>
      <label htmlFor="evm-verify-id">Contribution ID</label>
      <input id="evm-verify-id" inputMode="numeric" value={idText} onChange={e => setIdText(e.target.value)}/>
      <button type="button" className="ui-btn ui-primary" disabled={busy} onClick={verify}>{busy ? 'Verifying...' : 'Verify EVM Record (free)'}</button>
      <pre style={box}>{result}</pre>
      <p className="ui-help">For external JSON, verification fetches the current file and checks its exact bytes against the registered SHA-256. For legacy proofs, it hashes the on-chain evidence string. Neither approach establishes the truth or quality of the actual contribution.</p>
    </div>
  </section>
}
