import { useState } from 'react'
import { registryAbi as abi, registryAddress as contract, registryClient as client, loadContribution, sha256Text, statusName } from './EvmRegistryShared'

const box = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: 12 }

export default function EvmVerifyPanel() {
  const [idText, setIdText] = useState(() => new URLSearchParams(window.location.search).get('contribution') || '1')
  const [evidence, setEvidence] = useState(() => new URLSearchParams(window.location.search).get('evidence') || 'https://github.com/Qnam309/proof-of-contribution')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('Enter an ID and exact evidence URL to independently verify it against Portaldot V3.')

  async function verify() {
    setBusy(true)
    try {
      if (!/^[1-9]\d*$/.test(idText.trim())) throw Error('Enter a positive numeric Contribution ID.')
      const id = BigInt(idText.trim())
      const exactEvidence = evidence.trim()
      if (!exactEvidence) throw Error('Enter the exact evidence URI used during submission.')
      const contentHash = await sha256Text(exactEvidence)
      const contribution = await loadContribution(id)
      const verified = await client.readContract({
        address: contract, abi, functionName: 'verifyContribution', args: [id, contentHash]
      })
      const matchesURI = contribution.evidenceURI === exactEvidence
      setResult(`Contribution #${id}\nStatus: ${statusName(contribution.status)}\nContributor: ${contribution.contributor}\nReviewer: ${contribution.reviewer}\nRecorded evidence: ${contribution.evidenceURI}\nRecorded content hash: ${contribution.contentHash}\nYour evidence SHA-256: ${contentHash}\nExact URI matches record: ${matchesURI ? 'YES' : 'NO'}\nContract verifyContribution: ${verified}\n\n${verified && matchesURI && Number(contribution.status) === 2 ? 'VERIFIED: APPROVED ON-CHAIN' : 'NOT VERIFIED AS APPROVED FOR THIS EVIDENCE'}\n\nRead-only check — no transaction sent or POT spent.`)
    } catch (e) { setResult('Verification failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  return <section className="ui-panel ui-form-panel" style={{ marginTop: 22 }}>
    <div className="ui-panel-head"><div><h2>EVM Registry Verification</h2><p>Independently verify approved contributions against ContributionRegistry on V3.</p></div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      <p className="ui-help">No wallet connection is required. Uses the exact evidence URL text hashed with SHA-256, as in the current EVM submit test. This is separate from the native Substrate proof verifier above.</p>
      <label htmlFor="evm-verify-id">Contribution ID</label>
      <input id="evm-verify-id" inputMode="numeric" value={idText} onChange={e => setIdText(e.target.value)}/>
      <label htmlFor="evm-verify-evidence">Exact Evidence URL</label>
      <input id="evm-verify-evidence" type="url" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="https://..."/>
      <button type="button" className="ui-btn ui-primary" disabled={busy} onClick={verify}>{busy ? 'Verifying...' : 'Verify EVM Record (free)'}</button>
      <pre style={box}>{result}</pre>
      <p className="ui-help">Verification proves that the recorded URL text hash matches an approved on-chain record. It does not independently establish the contents of the linked page, their immutability, or the quality of a contribution.</p>
    </div>
  </section>
}
