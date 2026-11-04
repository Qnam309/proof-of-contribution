import { useEffect, useRef, useState } from 'react'
import { createWalletClient, custom, formatEther } from 'viem'
import {
  registryAbi as abi, registryAddress as contract, registryChain as chain,
  registryClient as client, validateSelectedEvm, loadContribution, statusName, parseProofEvidence, resolveProofEvidence
} from './EvmRegistryShared'

const box = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: 12 }
const eq = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export default function EvmReviewPanel({ provider, account, walletKind }) {
  const [idText, setIdText] = useState('1')
  const [record, setRecord] = useState(null)
  const [recordMetadata, setRecordMetadata] = useState(null)
  const [authorized, setAuthorized] = useState(false)
  const [preview, setPreview] = useState(null)
  const [action, setAction] = useState('approve')
  const [rejectReason, setRejectReason] = useState('')
  const [notePending, setNotePending] = useState(null)
  const [noteStatus, setNoteStatus] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Read an on-chain contribution to begin.')
  const [txHash, setTxHash] = useState('')
  const [queue, setQueue] = useState([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueMessage, setQueueMessage] = useState('')
  const queueRequest = useRef(0)
  const detailRequest = useRef(0)
  const [manualLookupOpen, setManualLookupOpen] = useState(false)
  // Recovery is separate from the on-chain review form: no second reject transaction.
  const [recoveryId, setRecoveryId] = useState('3')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryRecord, setRecoveryRecord] = useState(null)
  const [recoveryNote, setRecoveryNote] = useState(null)
  const [recoveryStatus, setRecoveryStatus] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const recoveryRequest = useRef(0)
  const isEvm = !!provider && !!account && ['metamask', 'okx'].includes(walletKind)

  useEffect(() => {
    detailRequest.current += 1
    recoveryRequest.current += 1
    setRecoveryRecord(null); setRecoveryNote(null); setRecoveryReason(''); setRecoveryStatus('')
    setRecord(null); setRecordMetadata(null); setPreview(null); setAgree(false); setAuthorized(false); setNotePending(null); setNoteStatus(''); setRejectReason('')
    setMessage('Wallet changed. Load the contribution again.')
  }, [account, walletKind])

  const parseId = () => {
    if (!/^[1-9]\d*$/.test(idText.trim())) throw Error('Enter a positive numeric Contribution ID.')
    return BigInt(idText.trim())
  }

  async function loadPending() {
    const request = ++queueRequest.current
    setQueueLoading(true); setQueueMessage(''); setQueue([])
    try {
      const nextId = await client.readContract({ address: contract, abi, functionName: 'nextId' })
      const total = nextId - 1n
      const windowSize = 100n
      const end = total > windowSize ? total - windowSize + 1n : 1n
      const ids = []
      for (let id = total; id >= end; id--) ids.push(id)
      const records = await Promise.all(ids.map(async id => {
        try { return { id, data: await client.readContract({ address: contract, abi, functionName: 'getContribution', args: [id] }) } }
        catch { return null }
      }))
      if (queueRequest.current !== request) return
      const pending = records.filter(entry => entry && Number(entry.data.status) === 1)
      // Show pending records immediately. External metadata is fetched and verified separately.
      setQueue(pending.map(entry => ({ ...entry, metadataStatus: 'loading' })))
      setQueueMessage(`Scanned ${ids.length} most recent on-chain records${total > windowSize ? ' (latest 100 only)' : ''}.`)
      // Small batches avoid flooding the testnet metadata endpoint.
      for (let offset = 0; offset < pending.length; offset += 3) {
        if (queueRequest.current !== request) return
        await Promise.all(pending.slice(offset, offset + 3).map(async entry => {
          let update
          try {
            const metadata = await resolveProofEvidence(entry.data.evidenceURI, entry.data.contentHash)
            update = { metadata, metadataStatus: 'verified' }
          } catch (error) {
            update = { metadataStatus: 'unavailable', metadataError: error?.message || 'Metadata could not be verified.' }
          }
          if (queueRequest.current === request) {
            setQueue(previous => previous.map(item => item.id === entry.id ? { ...item, ...update } : item))
          }
        }))
      }
    } catch (e) {
      if (queueRequest.current === request) setQueueMessage('Could not load pending records: ' + (e.shortMessage || e.message))
    } finally {
      if (queueRequest.current === request) setQueueLoading(false)
    }
  }

  // Clicking Review in the queue loads the contribution immediately.
  // Manual lookup remains available for records outside the latest-100 queue.
  async function readRecord(idOverride = null) {
    const request = ++detailRequest.current
    const selectedIdText = idOverride === null ? idText.trim() : String(idOverride)
    setIdText(selectedIdText)
    setBusy(true); setRecord(null); setRecordMetadata(null); setPreview(null); setAgree(false); setAuthorized(false)
    setMessage(`Loading Contribution #${selectedIdText}...`)
    try {
      if (!/^[1-9]\d*$/.test(selectedIdText)) throw Error('Enter a positive numeric Contribution ID.')
      const id = BigInt(selectedIdText)
      const contribution = await loadContribution(id)
      const metadata = await resolveProofEvidence(contribution.evidenceURI, contribution.contentHash)
      let permission = false
      if (isEvm) {
        await validateSelectedEvm(provider, account, walletKind)
        permission = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] })
      }
      if (detailRequest.current !== request) return
      setRecord(contribution)
      setRecordMetadata({ id: selectedIdText, metadata })
      setAuthorized(permission)
      setMessage(`Contribution #${id} loaded and metadata integrity verified. Review the evidence above before deciding.`)
    } catch (e) {
      if (detailRequest.current === request) setMessage('Load failed: ' + (e.shortMessage || e.message))
    } finally {
      if (detailRequest.current === request) setBusy(false)
    }
  }

  const rejectionMessage = (id, reviewer, reason) =>
    `PoC Ledger rejection reason\nChain ID: 420420777\nContract: ${contract.toLowerCase()}\nContribution ID: ${id}\nReviewer: ${reviewer.toLowerCase()}\nReason: ${reason}`

  async function publishReason(id, reason) {
    await validateSelectedEvm(provider, account, walletKind)
    const current = await loadContribution(id)
    if (Number(current.status) !== 3 || !eq(current.reviewer, account)) throw Error('Only the on-chain rejecting reviewer can publish the reason.')
    const wallet = createWalletClient({ chain, transport: custom(provider) })
    const signature = await wallet.signMessage({ account, message: rejectionMessage(id, account, reason) })
    const response = await fetch('/api/rejection-reason', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: String(id), reviewer: account, reason, signature })
    })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || 'Could not publish rejection reason.')
    setNoteStatus(`Signed rejection reason published for Contribution #${id} (off-chain).`)
    setNotePending(null)
  }

  async function retryReason() {
    if (!notePending || busy) return
    setBusy(true)
    try { await publishReason(notePending.id, notePending.reason) }
    catch (e) { setNoteStatus(`Reason not published: ${e.shortMessage || e.message}. You can retry without a new blockchain transaction.`) }
    finally { setBusy(false) }
  }

  async function inspectMissingReason() {
    const id = recoveryId.trim()
    const request = ++recoveryRequest.current
    setRecoveryRecord(null); setRecoveryNote(null); setRecoveryStatus(''); setRecoveryBusy(true)
    try {
      if (!/^[1-9]\d{0,14}$/.test(id)) throw Error('Enter a valid Contribution ID.')
      const record = await loadContribution(BigInt(id))
      if (Number(record.status) !== 3) throw Error(`Contribution #${id} is ${statusName(record.status)}, not Rejected.`)
      // Read-only status is public; only the original on-chain reviewer can publish.
      const response = await fetch(`/api/rejection-reason?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => { throw Error('Reason service returned an invalid response. Try again after checking deployment logs.') })
      if (request !== recoveryRequest.current) return
      if (response.ok) {
        setRecoveryNote(payload)
        setRecoveryStatus('A signed reason is already published. It cannot be replaced.')
      } else if (response.status === 404 && payload?.error === 'No signed rejection note published.') {
        setRecoveryStatus(eq(record.reviewer, account)
          ? 'No signed reason has been published yet. The rejecting reviewer can add one below.'
          : 'No reason is published. Only the original rejecting reviewer may add it.')
      } else {
        throw Error(payload?.error || `Reason service returned HTTP ${response.status}.`)
      }
      setRecoveryRecord({ id, reviewer: record.reviewer })
    } catch (e) {
      if (request === recoveryRequest.current) setRecoveryStatus(`Lookup failed: ${e.shortMessage || e.message}`)
    } finally {
      if (request === recoveryRequest.current) setRecoveryBusy(false)
    }
  }

  async function publishMissingReason() {
    if (!recoveryRecord || recoveryNote || recoveryBusy) return
    const reason = recoveryReason.trim()
    setRecoveryBusy(true)
    try {
      if (!eq(recoveryRecord.reviewer, account) || !isEvm) throw Error('Connect the wallet that rejected this contribution.')
      if (reason !== recoveryReason || reason.length < 10 || reason.length > 500) throw Error('Reason must be 10–500 characters without leading/trailing spaces.')
      // Re-check both chain state and the stored note immediately before signing.
      await validateSelectedEvm(provider, account, walletKind)
      const onchain = await loadContribution(BigInt(recoveryRecord.id))
      if (Number(onchain.status) !== 3 || !eq(onchain.reviewer, account)) throw Error('On-chain reviewer/status does not match.')
      const probe = await fetch(`/api/rejection-reason?id=${encodeURIComponent(recoveryRecord.id)}`, { cache: 'no-store' })
      const existing = await probe.json().catch(() => { throw Error('Reason service returned an invalid response.') })
      if (probe.ok) {
        setRecoveryNote(existing)
        setRecoveryStatus('A signed reason is already published. No changes allowed.')
        return
      }
      if (probe.status !== 404 || existing?.error !== 'No signed rejection note published.') {
        throw Error(existing?.error || 'Could not confirm the reason is missing.')
      }
      setRecoveryStatus('Confirm the message signature in your wallet. No gas is required.')
      await publishReason(BigInt(recoveryRecord.id), reason)
      // Read back from the server so the interface shows a verified stored note.
      const response = await fetch(`/api/rejection-reason?id=${encodeURIComponent(recoveryRecord.id)}`, { cache: 'no-store' })
      const result = await response.json().catch(() => { throw Error('Reason published, but could not read it back.') })
      if (!response.ok) throw Error(result?.error || 'Reason published, but verification readback failed.')
      setRecoveryNote(result)
      setRecoveryStatus('Signed rejection reason published and verified. No on-chain transaction was sent.')
    } catch (e) {
      setRecoveryStatus(`Publication failed: ${e.shortMessage || e.message}. No new reject transaction was sent.`)
    } finally { setRecoveryBusy(false) }
  }

  async function checkGas() {
    setBusy(true); setPreview(null); setAgree(false)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      const id = parseId()
      if (action === 'reject' && (rejectReason.trim().length < 10 || rejectReason.trim().length > 500)) throw Error('Enter a rejection reason (10–500 characters).')
      const contribution = await loadContribution(id)
      const permission = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] })
      if (!permission) throw Error('This account is not an authorized reviewer.')
      if (Number(contribution.status) !== 1) throw Error(`Contribution is ${statusName(contribution.status)}, not Pending Review.`)
      if (eq(contribution.contributor, account)) throw Error('A contributor cannot review their own contribution.')
      const metadata = action === 'approve' ? await resolveProofEvidence(contribution.evidenceURI, contribution.contentHash) : null
      const functionName = action === 'approve' ? 'approveContribution' : 'rejectContribution'
      const gasEstimated = await client.estimateContractGas({
        address: contract, abi, functionName, args: [id], account
      })
      const gasLimit = (gasEstimated * 105n + 99n) / 100n
      const gasPrice = await client.getGasPrice()
      const reserve = gasLimit * gasPrice
      const balance = await client.getBalance({ address: account })
      setRecord(contribution)
      setAuthorized(true)
      setMessage(`Action: ${action.toUpperCase()} Contribution #${id}\nEvidence: ${metadata ? metadata.evidenceUrl : parseProofEvidence(contribution.evidenceURI).evidenceUrl}\nMetadata integrity: ${metadata ? 'VERIFIED' : 'Not required for rejection'}\nEstimated gas: ${gasEstimated}\nGas limit (+5%): ${gasLimit}\nGas price: ${gasPrice} wei\nGas reserve: ${formatEther(reserve)} POT\nWallet balance: ${formatEther(balance)} POT\nThis is a reserve estimate, not the final fee.`)
      if (balance < reserve) {
        setMessage(m => m + '\nINSUFFICIENT POT. No transaction sent.')
        return
      }
      setPreview({ id, action, gasLimit, gasPrice, reserve, account, functionName, reason: action === 'reject' ? rejectReason.trim() : '' })
    } catch (e) { setMessage('Check failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  async function sendReview() {
    if (!preview || !agree || busy) return
    setBusy(true)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      if (preview.action !== action || preview.id !== parseId() || !eq(preview.account, account) || (action === 'reject' && preview.reason !== rejectReason.trim())) throw Error('Selection changed. Check gas again.')
      const [contribution, permission, currentGasPrice, balance] = await Promise.all([
        loadContribution(preview.id),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] }),
        client.getGasPrice(), client.getBalance({ address: account })
      ])
      if (preview.action === 'approve') await resolveProofEvidence(contribution.evidenceURI, contribution.contentHash)
      if (!permission || Number(contribution.status) !== 1 || eq(contribution.contributor, account)) throw Error('Reviewer permission or contribution status has changed.')
      if (currentGasPrice > preview.gasPrice || balance < preview.reserve) throw Error('Gas price or balance changed. Check gas again.')
      const currentEstimate = await client.estimateContractGas({ address: contract, abi, functionName: preview.functionName, args: [preview.id], account })
      if (currentEstimate > preview.gasLimit) throw Error('Required gas increased. Check gas again.')
      if (!window.confirm(`${action.toUpperCase()} contribution #${preview.id} on V3 Testnet?\n\nGas reserve: ${formatEther(preview.reserve)} POT\n\nMetaMask/OKX will ask for final confirmation.`)) return
      const wallet = createWalletClient({ chain, transport: custom(provider) })
      setMessage('Review the transaction carefully in your wallet...')
      const hash = await wallet.writeContract({ chain, account, address: contract, abi, functionName: preview.functionName, args: [preview.id], gas: preview.gasLimit, gasPrice: preview.gasPrice })
      setTxHash(hash)
      setMessage(`Transaction submitted: ${hash}\nWaiting for receipt...`)
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 })
      const updated = await loadContribution(preview.id)
      setRecord(updated)
      setMessage(`TX: ${hash}\nBlock: ${receipt.blockNumber}\nGas used: ${receipt.gasUsed}\nReceipt: ${receipt.status}\nOn-chain status: ${statusName(updated.status)}\nReviewer: ${updated.reviewer}\n${receipt.status === 'success' ? 'REVIEW TRANSACTION SUCCESSFUL' : 'REVIEW TRANSACTION FAILED'}`)
      setPreview(null); setAgree(false)
      if (preview.action === 'reject' && receipt.status === 'success' && Number(updated.status) === 3) {
        setNotePending({ id: preview.id, reason: preview.reason })
        setNoteStatus('On-chain rejection confirmed. Publish the signed reason in your wallet (no additional gas).')
        try { await publishReason(preview.id, preview.reason) }
        catch (e) { setNoteStatus(`On-chain rejection succeeded, but reason was not published: ${e.shortMessage || e.message}. Use Retry publishing reason below.`) }
      }
    } catch (e) { setMessage(m => `${m}\n\nERROR: ${e.shortMessage || e.message}`) }
    finally { setBusy(false) }
  }

  return <section className="ui-panel ui-form-panel" style={{ marginTop: 22 }}>
    <div className="ui-panel-head"><div><h2>EVM On-chain Review</h2><p>Read contributions and approve or reject using an authorized V3 reviewer.</p></div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      <div className="poc-queue-block">
        <div className="poc-queue-header"><strong>Pending contributions</strong><button className="ui-btn ui-outline" type="button" disabled={queueLoading} onClick={loadPending}>{queueLoading ? 'Loading...' : 'Load pending from V3 (free)'}</button></div>
        <p className="ui-help">Public read-only queue. Review transactions still require an authorized reviewer; the list searches the latest 100 records.</p>
        {queueMessage && <p className="ui-help" role="status">{queueMessage}</p>}
        {queue.map(entry => <div className="poc-queue-item" key={String(entry.id)}>
          <div>
            <strong>Contribution #{String(entry.id)}</strong>
            <small>{entry.metadataStatus === 'verified'
              ? (entry.metadata?.title || 'Legacy contribution')
              : entry.metadataStatus === 'loading' ? 'Checking evidence metadata...'
              : 'Metadata unavailable — open the record to inspect'}</small>
            {entry.metadataStatus === 'verified' && <small>{entry.metadata?.category || 'Legacy proof'} · Pending Review · SHA-256 verified</small>}
            {entry.metadataStatus === 'unavailable' && <small style={{ color: '#f3acac' }}>Metadata could not be verified</small>}
          </div>
          <button className="ui-btn ui-outline" type="button" disabled={busy} onClick={() => readRecord(entry.id)}>{busy && idText === String(entry.id) ? 'Loading...' : 'Review'}</button>
        </div>)}
        {!queueLoading && queueMessage && queue.length === 0 && <p className="ui-help">No pending entries found in the scanned range.</p>}
      </div>
      <p className="ui-help">This queue reads live V3 records. Only an authorized EVM reviewer can approve or reject on-chain.</p>
      <details className="poc-review-manual" open={manualLookupOpen} onToggle={e => setManualLookupOpen(e.currentTarget.open)}>
        <summary>Manual ID Lookup <span>For older or unlisted contributions</span></summary>
        <div className="poc-review-manual-fields">
          <label htmlFor="evm-review-id">On-chain Contribution ID</label>
          <input id="evm-review-id" inputMode="numeric" value={idText} onChange={e => { detailRequest.current += 1; setIdText(e.target.value); setPreview(null); setAgree(false); setRecord(null); setRecordMetadata(null); setAuthorized(false) }}/>
          <button type="button" className="ui-btn ui-outline" onClick={() => readRecord()} disabled={busy}>{busy ? 'Working...' : 'Load from V3 (free)'}</button>
        </div>
      </details>
      {record && recordMetadata && recordMetadata.id === idText.trim() && <section className="poc-review-detail" aria-label="Contribution details">
        <div className="poc-review-detail-head">
          <div>
            <span className="poc-review-detail-eyebrow">CONTRIBUTION #{recordMetadata.id}</span>
            <h3>{recordMetadata.metadata.title || 'Legacy contribution'}</h3>
            <p>{recordMetadata.metadata.category || 'Legacy proof'}</p>
          </div>
          <span className={`poc-review-status ${Number(record.status) === 2 ? 'is-approved' : Number(record.status) === 3 ? 'is-rejected' : ''}`}>{statusName(record.status)}</span>
        </div>
        <div className="poc-review-detail-section">
          <strong>Description</strong>
          <p>{recordMetadata.metadata.description || 'No description provided.'}</p>
        </div>
        <div className="poc-review-detail-section">
          <strong>Evidence</strong>
          {/^https?:\/\//i.test(recordMetadata.metadata.evidenceUrl || '')
            ? <a className="ui-btn ui-outline poc-review-evidence-link" href={recordMetadata.metadata.evidenceUrl} target="_blank" rel="noopener noreferrer">Open Evidence ↗</a>
            : <p>Evidence URL is unavailable or invalid.</p>}
          <small className="poc-review-evidence-url">{recordMetadata.metadata.evidenceUrl || '—'}</small>
        </div>
        <div className="poc-review-detail-footer">
          <span className="poc-review-integrity">✓ Metadata SHA-256 VERIFIED</span>
          <span>Reviewer permission: <strong>{authorized ? 'YES' : 'NO / not connected'}</strong></span>
        </div>
        <details className="poc-review-technical">
          <summary>Technical Details</summary>
          <dl>
            <dt>Contributor</dt><dd>{record.contributor}</dd>
            <dt>Reviewer</dt><dd>{record.reviewer}</dd>
            <dt>Content hash</dt><dd>{record.contentHash}</dd>
            <dt>Metadata source</dt><dd>{recordMetadata.metadata.isExternal ? recordMetadata.metadata.metadataUrl : 'Legacy on-chain'}</dd>
          </dl>
        </details>
      </section>}
      <label htmlFor="evm-review-action">Action</label>
      <select id="evm-review-action" value={action} onChange={e => { setAction(e.target.value); setPreview(null); setAgree(false) }}>
        <option value="approve">Approve</option><option value="reject">Reject</option>
      </select>
      {action === 'reject' && <div className="poc-rejection-editor">
        <label htmlFor="poc-rejection-reason">Reason for rejection *</label>
        <textarea id="poc-rejection-reason" rows={3} maxLength={500} value={rejectReason} onChange={e => { setRejectReason(e.target.value); setPreview(null); setAgree(false) }} placeholder="Explain what evidence is missing or why the contribution cannot be approved." />
        <small>10–500 characters. After the rejection transaction, the reviewer signs a separate public off-chain note. The reason is not stored in the smart contract.</small>
      </div>}
      <p className="ui-help">Selected wallet: {isEvm ? `${walletKind} · ${account}` : 'Connect MetaMask or OKX Wallet'}</p>
      <button type="button" className="ui-btn ui-outline" disabled={!isEvm || busy || !recordMetadata || recordMetadata.id !== idText.trim()} onClick={checkGas}>Check {action} gas</button>
      <pre style={box}>{message}</pre>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input style={{ width: 'auto' }} type="checkbox" checked={agree} disabled={!preview || busy} onChange={e => setAgree(e.target.checked)}/>
        I understand this writes a real V3 testnet transaction and may spend POT.
      </label>
      <button type="button" className="ui-btn ui-primary" disabled={!preview || !agree || busy} onClick={sendReview}>{action === 'approve' ? 'Approve on V3' : 'Reject on V3'}</button>
      {noteStatus && <p className="ui-help" role="status">{noteStatus}</p>}
      {notePending && <button className="ui-btn ui-outline" type="button" disabled={busy} onClick={retryReason}>Retry publishing signed rejection reason (no gas)</button>}
      {txHash && <p className="ui-help">Latest review TX: <code style={{ overflowWrap: 'anywhere' }}>{txHash}</code></p>}
      <details className="poc-review-manual" style={{ marginTop: 22 }}>
        <summary>Publish Missing Rejection Reason <span>Recovery after refresh or failed publication — no gas</span></summary>
        <div className="poc-review-manual-fields">
          <p className="ui-help">For an already Rejected contribution with no signed note. This does not reject again or edit an existing note.</p>
          <label htmlFor="poc-recovery-id">Rejected Contribution ID</label>
          <input id="poc-recovery-id" inputMode="numeric" value={recoveryId} onChange={e => {
            recoveryRequest.current += 1; setRecoveryId(e.target.value); setRecoveryRecord(null); setRecoveryNote(null); setRecoveryStatus(''); setRecoveryReason('')
          }} />
          <button type="button" className="ui-btn ui-outline" disabled={recoveryBusy} onClick={inspectMissingReason}>
            {recoveryBusy ? 'Checking...' : 'Check rejected record and existing reason (free)'}
          </button>
          {recoveryRecord && <p className="ui-help">On-chain rejecting reviewer: <code style={{ overflowWrap: 'anywhere' }}>{recoveryRecord.reviewer}</code></p>}
          {recoveryStatus && <p className="ui-help" role="status">{recoveryStatus}</p>}
          {recoveryNote ? <div className="poc-wallet-empty">
            <strong>Published signed reason (read-only)</strong>
            <p>{recoveryNote.reason}</p>
            <small>Signer: {recoveryNote.reviewer} · Public off-chain note verified against the on-chain rejection.</small>
          </div> : recoveryRecord && eq(recoveryRecord.reviewer, account) && isEvm ? <div className="poc-rejection-editor">
            <label htmlFor="poc-recovery-reason">Reason for rejection *</label>
            <textarea id="poc-recovery-reason" rows={3} maxLength={500} value={recoveryReason} onChange={e => setRecoveryReason(e.target.value)} placeholder="Explain why this already-rejected contribution was not approved." />
            <small>10–500 characters. Signed by the original rejecting wallet. Once published, this note cannot be changed through the DApp.</small>
            <button type="button" className="ui-btn ui-primary" disabled={recoveryBusy || recoveryReason.trim().length < 10 || recoveryReason.trim().length > 500 || recoveryReason.trim() !== recoveryReason} onClick={publishMissingReason}>
              {recoveryBusy ? 'Publishing...' : 'Sign & publish missing reason (no gas)'}
            </button>
          </div> : null}
        </div>
      </details>
    </div>
  </section>
}
