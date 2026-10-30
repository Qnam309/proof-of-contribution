import { useEffect, useState } from 'react'
import { createWalletClient, custom, formatEther } from 'viem'
import {
  registryAbi as abi, registryAddress as contract, registryChain as chain,
  registryClient as client, validateSelectedEvm, loadContribution, statusName
} from './EvmRegistryShared'

const box = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: 12 }
const eq = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export default function EvmReviewPanel({ provider, account, walletKind }) {
  const [idText, setIdText] = useState('1')
  const [record, setRecord] = useState(null)
  const [authorized, setAuthorized] = useState(false)
  const [preview, setPreview] = useState(null)
  const [action, setAction] = useState('approve')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Read an on-chain contribution to begin.')
  const [txHash, setTxHash] = useState('')
  const [queue, setQueue] = useState([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueMessage, setQueueMessage] = useState('')
  const isEvm = !!provider && !!account && ['metamask', 'okx'].includes(walletKind)

  useEffect(() => {
    setRecord(null); setPreview(null); setAgree(false); setAuthorized(false)
    setMessage('Wallet changed. Load the contribution again.')
  }, [account, walletKind])

  const parseId = () => {
    if (!/^[1-9]\d*$/.test(idText.trim())) throw Error('Enter a positive numeric Contribution ID.')
    return BigInt(idText.trim())
  }

  async function loadPending() {
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
      setQueue(records.filter(entry => entry && Number(entry.data.status) === 1))
      setQueueMessage(`Scanned ${ids.length} most recent on-chain records${total > windowSize ? ' (latest 100 only)' : ''}.`)
    } catch (e) { setQueueMessage('Could not load pending records: ' + (e.shortMessage || e.message)) }
    finally { setQueueLoading(false) }
  }

  async function readRecord() {
    setBusy(true); setRecord(null); setPreview(null); setAgree(false)
    try {
      const id = parseId()
      const contribution = await loadContribution(id)
      setRecord(contribution)
      let permission = false
      if (isEvm) {
        await validateSelectedEvm(provider, account, walletKind)
        permission = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] })
      }
      setAuthorized(permission)
      setMessage(`Contribution #${id}\nStatus: ${statusName(contribution.status)}\nContributor: ${contribution.contributor}\nReviewer: ${contribution.reviewer}\nEvidence URI: ${contribution.evidenceURI}\nContent hash: ${contribution.contentHash}\nYour reviewer permission: ${permission ? 'YES' : 'NO / wallet not connected'}`)
    } catch (e) { setMessage('Load failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  async function checkGas() {
    setBusy(true); setPreview(null); setAgree(false)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      const id = parseId()
      const contribution = await loadContribution(id)
      const permission = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] })
      if (!permission) throw Error('This account is not an authorized reviewer.')
      if (Number(contribution.status) !== 1) throw Error(`Contribution is ${statusName(contribution.status)}, not Pending Review.`)
      if (eq(contribution.contributor, account)) throw Error('A contributor cannot review their own contribution.')
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
      setMessage(`Action: ${action.toUpperCase()} Contribution #${id}\nEvidence: ${contribution.evidenceURI}\nEstimated gas: ${gasEstimated}\nGas limit (+5%): ${gasLimit}\nGas price: ${gasPrice} wei\nGas reserve: ${formatEther(reserve)} POT\nWallet balance: ${formatEther(balance)} POT\nThis is a reserve estimate, not the final fee.`)
      if (balance < reserve) {
        setMessage(m => m + '\nINSUFFICIENT POT. No transaction sent.')
        return
      }
      setPreview({ id, action, gasLimit, gasPrice, reserve, account, functionName })
    } catch (e) { setMessage('Check failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  async function sendReview() {
    if (!preview || !agree || busy) return
    setBusy(true)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      if (preview.action !== action || preview.id !== parseId() || !eq(preview.account, account)) throw Error('Selection changed. Check gas again.')
      const [contribution, permission, currentGasPrice, balance] = await Promise.all([
        loadContribution(preview.id),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [account] }),
        client.getGasPrice(), client.getBalance({ address: account })
      ])
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
          <div><strong>Contribution #{String(entry.id)}</strong><small>{entry.data.evidenceURI}</small></div>
          <button className="ui-btn ui-outline" type="button" onClick={() => { setIdText(String(entry.id)); setRecord(null); setPreview(null); setAgree(false); setMessage('Contribution selected. Click Load from V3 to inspect it.') }}>Review</button>
        </div>)}
        {!queueLoading && queueMessage && queue.length === 0 && <p className="ui-help">No pending entries found in the scanned range.</p>}
      </div>
      <p className="ui-help">This panel uses the deployed ContributionRegistry on V3. The demo queue above remains browser-only. A connected authorized EVM reviewer is required to send review transactions.</p>
      <label htmlFor="evm-review-id">On-chain Contribution ID</label>
      <input id="evm-review-id" inputMode="numeric" value={idText} onChange={e => { setIdText(e.target.value); setPreview(null); setAgree(false); setRecord(null) }}/>
      <button type="button" className="ui-btn ui-outline" onClick={readRecord} disabled={busy}>{busy ? 'Working...' : 'Load from V3 (free)'}</button>
      {record && <p className="ui-help">Status: <strong>{statusName(record.status)}</strong> · Reviewer permission: {authorized ? 'YES' : 'NO'}</p>}
      <label htmlFor="evm-review-action">Action</label>
      <select id="evm-review-action" value={action} onChange={e => { setAction(e.target.value); setPreview(null); setAgree(false) }}>
        <option value="approve">Approve</option><option value="reject">Reject</option>
      </select>
      <p className="ui-help">Selected wallet: {isEvm ? `${walletKind} · ${account}` : 'Connect MetaMask or OKX Wallet'}</p>
      <button type="button" className="ui-btn ui-outline" disabled={!isEvm || busy} onClick={checkGas}>Check {action} gas</button>
      <pre style={box}>{message}</pre>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input style={{ width: 'auto' }} type="checkbox" checked={agree} disabled={!preview || busy} onChange={e => setAgree(e.target.checked)}/>
        I understand this writes a real V3 testnet transaction and may spend POT.
      </label>
      <button type="button" className="ui-btn ui-primary" disabled={!preview || !agree || busy} onClick={sendReview}>{action === 'approve' ? 'Approve on V3' : 'Reject on V3'}</button>
      {txHash && <p className="ui-help">Latest review TX: <code style={{ overflowWrap: 'anywhere' }}>{txHash}</code></p>}
    </div>
  </section>
}
