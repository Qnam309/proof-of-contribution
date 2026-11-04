import { useEffect, useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { registryClient, registryAddress, registryAbi, loadContribution, resolveProofEvidence, statusName } from './EvmRegistryShared'

const NATIVE_RPC = 'wss://test-node-v3.portaldot.dev'
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const RECORD_KEY = 'poc-unified-native-anchors-v1'
const pick = (value) => String(value || '').trim()
const cleanId = value => /^[1-9]\d{0,14}$/.test(pick(value))
const nativeLink = (id, hash, block) => {
  const url = new URL(location.origin + location.pathname)
  url.searchParams.set('contribution', String(id))
  url.searchParams.set('nativeTx', hash)
  url.searchParams.set('nativeBlock', block)
  return url.toString()
}
const toError = error => error?.message || String(error)

async function connectNative() {
  const api = await ApiPromise.create({ provider: new WsProvider(NATIVE_RPC) })
  if (!(await api.rpc.system.chain()).toString().toLowerCase().includes('portaldot')) {
    await api.disconnect()
    throw Error('Unexpected native chain. Native proof has not been sent.')
  }
  return api
}

async function validateNativeProof(api, { txHash, block }, expectedHash) {
  if (!HEX32.test(txHash)) throw Error('Invalid Native transaction hash.')
  if (!(HEX32.test(block) || /^\d+$/.test(block))) throw Error('Native block hash or number is required.')
  const blockHash = /^\d+$/.test(block) ? (await api.rpc.chain.getBlockHash(block)).toHex() : block
  const signed = await api.rpc.chain.getBlock(blockHash)
  const blockNumber = signed.block.header.number.toString()
  const canonical = (await api.rpc.chain.getBlockHash(blockNumber)).toHex()
  if (canonical.toLowerCase() !== blockHash.toLowerCase()) throw Error('Native block is not canonical.')
  const finalHead = await api.rpc.chain.getFinalizedHead()
  const finalHeader = await api.rpc.chain.getHeader(finalHead)
  if (BigInt(blockNumber) > BigInt(finalHeader.number.toString())) throw Error('Native block is not finalized.')
  const index = signed.block.extrinsics.findIndex(e => e.hash.toHex().toLowerCase() === txHash.toLowerCase())
  if (index < 0) throw Error('Native transaction was not found in the supplied block.')
  const ext = signed.block.extrinsics[index]
  if (ext.method.section !== 'system' || ext.method.method !== 'remarkWithEvent') throw Error('Not a remarkWithEvent transaction.')
  const remark = ext.method.args[0].toHex()
  if (remark.toLowerCase() !== expectedHash.toLowerCase()) throw Error('Native remark does not match EVM metadata SHA-256.')
  const events = (await api.query.system.events.at(blockHash)).filter(e => e.phase.isApplyExtrinsic && e.phase.asApplyExtrinsic.toNumber() === index)
  if (!events.some(e => e.event.section === 'system' && e.event.method === 'ExtrinsicSuccess') || !events.some(e => e.event.section === 'system' && e.event.method === 'Remarked')) throw Error('Missing successful execution / Remarked event.')
  return { blockNumber, blockHash, index, signer: ext.signer.toString(), txHash: ext.hash.toHex(), hash: remark }
}

export default function UnifiedProofPanel({ account, walletKind }) {
  const params = new URLSearchParams(window.location.search)
  const [idText, setIdText] = useState(params.get('contribution') || '2')
  const [txHash, setTxHash] = useState(params.get('nativeTx') || '')
  const [block, setBlock] = useState(params.get('nativeBlock') || '')
  const [record, setRecord] = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [estimate, setEstimate] = useState(null)
  const [nativeAccount, setNativeAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Load an EVM contribution to inspect its metadata SHA-256.')
  const [verified, setVerified] = useState(null)
  const [pendingNative, setPendingNative] = useState(null)

  useEffect(() => { setEstimate(null); setNativeAccount('') }, [account, walletKind])

  // A shared link is a request to perform fresh read-only verification, not
  // a claim that the proof has already passed verification.
  const sharedProof = cleanId(params.get('contribution')) &&
    !!params.get('nativeTx') && !!params.get('nativeBlock')

  async function verifySharedLink(isCancelled = () => false) {
    const id = pick(params.get('contribution'))
    const nativeTx = pick(params.get('nativeTx'))
    const nativeBlock = pick(params.get('nativeBlock'))
    setBusy(true); setVerified(null); setRecord(null); setMetadata(null); setEstimate(null)
    setMessage('Verifying the shared EVM and Native records directly from Portaldot V3...')
    let api
    try {
      if (!cleanId(id) || !HEX32.test(nativeTx) || !(HEX32.test(nativeBlock) || /^\d+$/.test(nativeBlock))) {
        throw Error('Shared link is missing a valid Contribution ID, Native transaction hash, or Native block.')
      }
      const contribution = await loadContribution(BigInt(id))
      const details = await resolveProofEvidence(contribution.evidenceURI, contribution.contentHash)
      if (isCancelled()) return
      setRecord(contribution); setMetadata(details)
      api = await connectNative()
      const checked = await validateNativeProof(api, { txHash: nativeTx, block: nativeBlock }, contribution.contentHash)
      if (isCancelled()) return
      setTxHash(nativeTx); setBlock(nativeBlock)
      setVerified(checked)
      setMessage(`UNIFIED VERIFIED: EVM metadata SHA-256 and Native remarkWithEvent match. EVM review status: ${statusName(contribution.status)}. Native signer: ${checked.signer}. Read-only verification, no wallet required.`)
    } catch (error) {
      if (!isCancelled()) setMessage(`Shared proof verification failed: ${toError(error)}. You can retry the read-only verification below.`)
    } finally {
      if (api) await api.disconnect().catch(() => {})
      if (!isCancelled()) setBusy(false)
    }
  }

  useEffect(() => {
    if (!sharedProof) return
    let cancelled = false
    verifySharedLink(() => cancelled)
    return () => { cancelled = true }
    // Run once for the shared URL on page entry; the retry button allows rechecking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setBusy(true); setEstimate(null); setRecord(null); setMetadata(null); setVerified(null); setPendingNative(null)
    try {
      if (!cleanId(idText)) throw Error('Enter a valid EVM Contribution ID.')
      const current = await loadContribution(BigInt(idText))
      const details = await resolveProofEvidence(current.evidenceURI, current.contentHash)
      setRecord(current); setMetadata(details)
      setMessage(`Contribution #${idText} · ${statusName(current.status)} · metadata SHA-256 VERIFIED. This is the hash the native wallet can anchor.`)
      try {
        const saved = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}')[idText]
        if (saved && !params.has('nativeTx')) { setTxHash(saved.txHash || ''); setBlock(saved.blockHash || saved.block || ''); setPendingNative(saved) }
      } catch { /* storage is optional */ }
    } catch (error) { setMessage(`Load failed: ${toError(error)}`) }
    finally { setBusy(false) }
  }

  async function checkFee() {
    if (!record) return
    setBusy(true); setEstimate(null)
    let api
    try {
      if (walletKind !== 'portaldot' || !account) throw Error('Connect Portaldot Wallet (native 5... address) first.')
      const extension = window.injectedWeb3?.['portaldot extension']
      if (!extension) throw Error('Portaldot Wallet extension not found.')
      const enabled = await extension.enable('PoC Ledger')
      const available = await enabled.accounts.get()
      if (!available.some(item => item.address === account)) throw Error('Connected native account was not found in extension.')
      if (!enabled.signer?.signPayload) throw Error('Portaldot Wallet cannot sign native transactions.')
      api = await connectNative()
      if (!api.tx.system.remarkWithEvent) throw Error('Native remarkWithEvent is unsupported.')
      const tx = api.tx.system.remarkWithEvent(record.contentHash)
      const fee = await tx.paymentInfo(account)
      const info = await api.query.system.account(account)
      const decimals = api.registry.chainDecimals[0] ?? 12
      const symbol = api.registry.chainTokens[0] ?? 'POT'
      const balance = info.data.free.toBigInt()
      const reserved = info.data.reserved.toBigInt()
      const frozen = info.data.frozen?.toBigInt?.() ?? 0n
      const spendable = balance > frozen ? balance - frozen : 0n
      const format = value => (Number(value) / 10 ** decimals).toFixed(8)
      const amount = fee.partialFee.toBigInt()
      setEstimate({ id: idText, account, hash: record.contentHash, fee: amount.toString(), symbol, decimals, sufficient: spendable > amount })
      setNativeAccount(account)
      setMessage(`Native fee estimate: ${format(amount)} ${symbol}\nFree: ${format(balance)} ${symbol} · Reserved: ${format(reserved)} ${symbol}\nSpendable before existential deposit: ${format(spendable)} ${symbol}\n${spendable > amount ? 'Estimated fee covered. Final cost may vary.' : 'Insufficient spendable balance.'}\nNote: existential deposit and additional transaction costs may apply.`)
    } catch (error) { setMessage(`Native fee check failed: ${toError(error)}`) }
    finally { if (api) await api.disconnect().catch(() => {}); setBusy(false) }
  }

  async function publish() {
    if (!estimate || busy || !estimate.sufficient) return
    setBusy(true); let api; let unsubscribe
    try {
      if (!record || estimate.id !== idText || estimate.hash !== record.contentHash || estimate.account !== account || walletKind !== 'portaldot') throw Error('Selection changed. Check native fee again.')
      const wallet = window.injectedWeb3?.['portaldot extension']
      if (!wallet) throw Error('Native wallet unavailable.')
      const enabled = await wallet.enable('PoC Ledger')
      if (!(await enabled.accounts.get()).some(x => x.address === account)) throw Error('Native account changed.')
      if (!enabled.signer?.signPayload) throw Error('No native transaction signer available.')
      api = await connectNative()
      const tx = api.tx.system.remarkWithEvent(record.contentHash)
      const currentFee = (await tx.paymentInfo(account)).partialFee.toBigInt()
      if (currentFee > BigInt(estimate.fee) * 12n / 10n) throw Error('Native fee increased. Check fee again.')
      if (!window.confirm(`Anchor EVM Contribution #${idText} to Portaldot Native?\n\nMetadata SHA-256: ${record.contentHash}\nEstimated fee: ${estimate.fee} base units\n\nThis submits a REAL testnet transaction. Continue?`)) return
      setMessage('Approve the native transaction in Portaldot Wallet...')
      const outcome = await new Promise((resolve, reject) => {
        let finished = false
        tx.signAndSend(account, { signer: enabled.signer }, result => {
          if (finished) return
          const failed = result.dispatchError || result.events?.some(e => e.event.section === 'system' && e.event.method === 'ExtrinsicFailed')
          if (failed) { finished = true; reject(Error('Native transaction failed: ' + (result.dispatchError?.toString() || 'ExtrinsicFailed'))); return }
          if (result.status.isInBlock) {
            const seen = { txHash: tx.hash.toHex(), blockHash: result.status.asInBlock.toHex(), finalized: false }
            setTxHash(seen.txHash); setBlock(seen.blockHash); setPendingNative(seen)
            try { const previous = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); previous[idText] = seen; localStorage.setItem(RECORD_KEY, JSON.stringify(previous)) } catch { /* optional only */ }
            setMessage('Native transaction included in a block. Waiting for finality; do not publish again.')
          }
          if (result.status.isFinalized) { finished = true; resolve({ txHash: tx.hash.toHex(), blockHash: result.status.asFinalized.toHex() }) }
        }).then(unsub => { unsubscribe = unsub }).catch(reject)
      })
      if (unsubscribe) { unsubscribe(); unsubscribe = null }
      // Keep the finalized transaction reference BEFORE secondary verification.
      // Verification failures must never hide a transaction that was submitted.
      setTxHash(outcome.txHash); setBlock(outcome.blockHash); setEstimate(null)
      const finalized = { ...outcome, finalized: true }
      setPendingNative(finalized)
      try { const previous = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); previous[idText] = finalized; localStorage.setItem(RECORD_KEY, JSON.stringify(previous)) } catch { /* optional only */ }
      let confirmed
      try { confirmed = await validateNativeProof(api, { txHash: outcome.txHash, block: outcome.blockHash }, record.contentHash) }
      catch (verificationError) {
        setMessage(`Native transaction FINALIZED and saved for Contribution #${idText}. TX: ${outcome.txHash}\nBlock: ${outcome.blockHash}\nAutomatic verification could not complete: ${toError(verificationError)}. Use Verify EVM + Native (free). Do not publish again.`)
        return
      }
      setVerified(confirmed)
      setMessage(`NATIVE ANCHOR VERIFIED for EVM Contribution #${idText}. The same SHA-256 is recorded in both environments. Copy the shared link for public verification.`)
    } catch (error) { setMessage(`Native publication failed or could not be confirmed: ${toError(error)}. If you approved a wallet transaction, check the native explorer before publishing again.`) }
    finally { if (unsubscribe) unsubscribe(); if (api) await api.disconnect().catch(() => {}); setBusy(false) }
  }

  async function verify() {
    setBusy(true); setVerified(null)
    let api
    try {
      if (!record) throw Error('Load the EVM contribution first.')
      api = await connectNative()
      const valid = await validateNativeProof(api, { txHash: pick(txHash), block: pick(block) }, record.contentHash)
      setVerified(valid)
      setPendingNative({ txHash: valid.txHash, blockHash: valid.blockHash, finalized: true })
      try { const previous = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); previous[idText] = { txHash: valid.txHash, blockHash: valid.blockHash, finalized: true }; localStorage.setItem(RECORD_KEY, JSON.stringify(previous)) } catch { /* optional only */ }
      setMessage(`UNIFIED VERIFIED: EVM metadata SHA-256 and Native remarkWithEvent match. EVM review status: ${statusName(record.status)}. Native signer: ${valid.signer}.`)
    } catch (error) { setMessage(`Native proof did not verify: ${toError(error)}`) }
    finally { if (api) await api.disconnect().catch(() => {}); setBusy(false) }
  }

  async function share() {
    if (!verified) return
    try { await navigator.clipboard.writeText(nativeLink(idText, txHash, block)); setMessage('Unified proof link copied. Anyone can open and verify without a wallet.') }
    catch { setMessage('Clipboard unavailable. Copy the URL manually.') }
  }

  return <section className="ui-panel ui-form-panel" style={{ marginTop: 20 }}>
    <div className="ui-panel-head"><div><h2>Unified EVM + Native Proof</h2><p>Verify a contribution across the EVM Registry and Portaldot Native blockchain. No wallet is needed to view or verify.</p></div></div>
    <div className="ui-form" style={{ padding: 20 }}>
      {!sharedProof && <>
        <label htmlFor="unified-id">EVM Contribution ID</label>
        <input id="unified-id" inputMode="numeric" value={idText} onChange={e => {setIdText(e.target.value);setRecord(null);setMetadata(null);setEstimate(null);setVerified(null);setPendingNative(null);setTxHash('');setBlock('')}}/>
        <button className="ui-btn ui-outline" type="button" onClick={load} disabled={busy}>Load EVM contribution (free)</button>
      </>}
      {sharedProof && <>
        <p className="ui-help" role="note">Public proof · Contribution #{idText}. This page checks both records directly from Portaldot V3. No wallet or gas required.</p>
        <button className="ui-btn ui-outline" type="button" onClick={() => verifySharedLink()} disabled={busy}>{busy ? 'Verifying...' : 'Verify again (free)'}</button>
      </>}
      {record && metadata && <div className="ui-info" style={{display:'block', marginTop:14}}>
        <strong>Contribution #{idText}: {metadata.title || 'Legacy proof'}</strong>
        <p>EVM review status: <strong>{statusName(record.status)}</strong></p>
        <p style={{overflowWrap:'anywhere'}}>Metadata SHA-256: <code>{record.contentHash}</code></p>
        <p>Contributor: {record.contributor}</p>
      </div>}
      {verified && <div className="ui-info" style={{display:'block', marginTop:14}} role="status">
        <strong style={{color:'#7ce5ac'}}>✓ UNIFIED PROOF VERIFIED</strong>
        <p>EVM metadata integrity: VERIFIED · Native hash: MATCHED</p>
        <p>Native block #{verified.blockNumber} · Extrinsic #{verified.index} · Finalized</p>
        <p style={{overflowWrap:'anywhere'}}>Native signer: {verified.signer}</p>
        <p className="ui-help">This verifies matching on-chain hashes, not contribution authenticity or ownership of both wallets.</p>
        <button className="ui-btn ui-outline" type="button" onClick={share}>Copy unified proof link</button>
      </div>}
      {!sharedProof && <>
        <details style={{marginTop:20}}>
          <summary style={{cursor:'pointer',fontWeight:700,padding:'12px 0'}}>Verify an existing Native Anchor</summary>
          <p className="ui-help">Enter a Native transaction hash and its block hash/number. If you previously anchored this contribution in this browser, the saved reference may be filled automatically.</p>
          <label htmlFor="native-tx-unified">Native transaction hash</label>
          <input id="native-tx-unified" value={txHash} onChange={e=>{setTxHash(e.target.value);setVerified(null)}} placeholder="0x..."/>
          <label htmlFor="native-block-unified">Native block hash or block number</label>
          <input id="native-block-unified" value={block} onChange={e=>{setBlock(e.target.value);setVerified(null)}} placeholder="0x... or block number"/>
          <button className="ui-btn ui-outline" type="button" onClick={verify} disabled={busy || !record || !txHash || !block}>Verify EVM + Native (free)</button>
        </details>
        <details style={{marginTop:16}}>
          <summary style={{cursor:'pointer',fontWeight:700,padding:'12px 0'}}>Create a Native Anchor (Portaldot Wallet)</summary>
          <p className="ui-help">Optional. Use Portaldot Wallet to record the EVM metadata SHA-256 with system.remarkWithEvent. This sends a real testnet transaction.</p>
          <p className="ui-help">Native wallet: {walletKind === 'portaldot' ? nativeAccount || account : 'Connect Portaldot Wallet from the header'}</p>
          <button className="ui-btn ui-outline" type="button" onClick={checkFee} disabled={busy || !record || walletKind !== 'portaldot' || !!(pendingNative?.txHash && pendingNative?.blockHash)}>Check Native Fee (free)</button>
          <button className="ui-btn ui-primary" type="button" onClick={publish} disabled={busy || !estimate?.sufficient || !!(pendingNative?.txHash && pendingNative?.blockHash)}>Publish Native Anchor (testnet transaction)</button>
          {pendingNative?.txHash && pendingNative?.blockHash && <p className="ui-help">A Native transaction is already recorded for this contribution. Do not publish a duplicate. Use Verify an existing Native Anchor above.</p>}
        </details>
      </>}
      <pre role="status" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12,lineHeight:1.7,marginTop:16}}>{message}</pre>
    </div>
  </section>
}
