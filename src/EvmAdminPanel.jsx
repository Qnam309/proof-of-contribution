import { useEffect, useState } from 'react'
import { createWalletClient, custom, formatEther, isAddress } from 'viem'
import { registryClient as client, registryAbi as abi, registryAddress as contract, registryChain as chain, validateSelectedEvm } from './EvmRegistryShared'

const INITIAL_REVIEWERS = ['0xf51e2695aB684496E902Ba30911318A2644bD344']
const REVIEWER_STORAGE = 'poc-known-reviewers-v3'
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export default function EvmAdminPanel({ provider, account, walletKind }) {
  const [known, setKnown] = useState(() => {
    try { return [...new Set([...INITIAL_REVIEWERS,...JSON.parse(localStorage.getItem(REVIEWER_STORAGE) || '[]')].filter(isAddress))] }
    catch { return [...INITIAL_REVIEWERS] }
  })
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [showRevoked, setShowRevoked] = useState(false)
  const [admin, setAdmin] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [authorized, setAuthorized] = useState(null)
  const action = 'grant'
  const [preview, setPreview] = useState(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Check admin permissions before managing reviewers.')
  const isEvm = !!provider && !!account && ['metamask', 'okx'].includes(walletKind)
  const isAdmin = isEvm && same(admin, account)

  useEffect(() => { setPreview(null); setAgree(false); setAuthorized(null); setAdmin(''); setMessage('Wallet changed. Refresh admin status.') }, [account, walletKind])

  async function loadList(addresses = known) {
    setListLoading(true); setListError('')
    try {
      const results = await Promise.all(addresses.map(async address => ({
        address,
        allowed: await client.readContract({address: contract,abi,functionName:'reviewers',args:[address]})
      })))
      setList(results)
    } catch(e) { setListError(e.shortMessage || e.message) }
    finally { setListLoading(false) }
  }
  function trackReviewer(address) {
    const next = [...new Set([...known,address])]
    setKnown(next)
    localStorage.setItem(REVIEWER_STORAGE,JSON.stringify(next))
    loadList(next)
  }
  async function revokeFromRow(address) {
    if (busy || !isAdmin || !isAddress(address)) return
    setBusy(true)
    setPreview(null); setAgree(false)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      const [onChainAdmin, allowed] = await Promise.all([
        client.readContract({ address: contract, abi, functionName: 'admin' }),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [address] })
      ])
      if (!same(onChainAdmin, account)) throw Error('Only the contract admin may revoke reviewers.')
      if (!allowed) {
        await loadList()
        throw Error('This reviewer has already been revoked. No transaction sent.')
      }
      const estimatedGas = await client.estimateContractGas({
        address: contract, abi, functionName: 'setReviewer', args: [address, false], account
      })
      const gasLimit = (estimatedGas * 105n + 99n) / 100n
      const gasPrice = await client.getGasPrice()
      const reserve = gasLimit * gasPrice
      const balance = await client.getBalance({ address: account })
      if (balance < reserve) throw Error(`Insufficient balance. Estimated gas reserve: ${formatEther(reserve)} POT; balance: ${formatEther(balance)} POT.`)
      const confirm = window.confirm(
        `Revoke reviewer permission on Portaldot V3 Testnet?\n\n` +
        `Reviewer: ${address}\n` +
        `Estimated gas reserve: ${formatEther(reserve)} POT\n` +
        `Current balance: ${formatEther(balance)} POT\n\n` +
        `This disables future reviews by this address but does not undo past approvals.\n` +
        `MetaMask/OKX will ask for a final transaction confirmation.`
      )
      if (!confirm) { setMessage('Revocation cancelled. No transaction sent.'); return }
      await validateSelectedEvm(provider, account, walletKind)
      const [adminNow, allowedNow, priceNow, balanceNow] = await Promise.all([
        client.readContract({ address: contract, abi, functionName: 'admin' }),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [address] }),
        client.getGasPrice(), client.getBalance({ address: account })
      ])
      if (!same(adminNow, account) || !allowedNow) throw Error('Admin/reviewer status changed. Refresh and retry.')
      if (priceNow > gasPrice || balanceNow < reserve) throw Error('Gas price or balance changed. Refresh and retry.')
      const updatedGas = await client.estimateContractGas({
        address: contract, abi, functionName: 'setReviewer', args: [address, false], account
      })
      if (updatedGas > gasLimit) throw Error('Estimated gas increased. Refresh and retry.')
      const wallet = createWalletClient({ chain, transport: custom(provider) })
      setMessage(`Revoke ${address}: awaiting wallet confirmation...`)
      const txHash = await wallet.writeContract({
        chain, account, address: contract, abi, functionName: 'setReviewer',
        args: [address, false], gas: gasLimit, gasPrice
      })
      setMessage(`Revoke TX: ${txHash}\nWaiting for confirmation...`)
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 120000 })
      const permissionNow = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [address] })
      setMessage(`Revoke TX: ${txHash}\nBlock: ${receipt.blockNumber}\nGas used: ${receipt.gasUsed}\nReceipt: ${receipt.status}\nReviewer authorized: ${permissionNow}\n` +
        (receipt.status === 'success' && permissionNow === false ? 'REVIEWER REVOKED SUCCESSFULLY' : 'REVOKE NOT VERIFIED'))
      await loadList()
    } catch (e) {
      setMessage('Revoke failed or cancelled: ' + (e.shortMessage || e.message))
    } finally {
      setBusy(false)
    }
  }
  async function refresh() {
    setBusy(true); setPreview(null); setAgree(false)
    loadList()
    try {
      const onChainAdmin = await client.readContract({ address: contract, abi, functionName: 'admin' })
      setAdmin(onChainAdmin)
      setMessage(`Contract admin: ${onChainAdmin}\nConnected wallet: ${account || 'None'}\nAdmin access: ${isEvm && same(onChainAdmin, account) ? 'YES' : 'NO'}`)
      if (isAddress(reviewer)) {
        const allowed = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [reviewer] })
        setAuthorized(allowed)
      }
    } catch (e) { setMessage('Read failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  async function checkGas() {
    setBusy(true); setPreview(null); setAgree(false)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      if (!isAddress(reviewer)) throw Error('Enter a valid EVM reviewer address (0x...).')
      const [onChainAdmin, allowed] = await Promise.all([
        client.readContract({ address: contract, abi, functionName: 'admin' }),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [reviewer] })
      ])
      setAdmin(onChainAdmin); setAuthorized(allowed)
      if (!same(account, onChainAdmin)) throw Error('Only the on-chain contract admin can change reviewer permissions.')
      const requested = action === 'grant'
      if (allowed === requested) throw Error(`Reviewer is already ${requested ? 'authorized' : 'not authorized'}. No transaction needed.`)
      const gas = await client.estimateContractGas({ address: contract, abi, functionName: 'setReviewer', args: [reviewer, requested], account })
      const gasLimit = (gas * 105n + 99n) / 100n
      const gasPrice = await client.getGasPrice()
      const reserve = gasLimit * gasPrice
      const balance = await client.getBalance({ address: account })
      setMessage(`Admin: ${onChainAdmin}\nReviewer: ${reviewer}\nCurrently authorized: ${allowed}\nAction: ${action}\nGas estimate: ${gas}\nGas limit (+5%): ${gasLimit}\nGas price: ${gasPrice} wei\nGas reserve: ${formatEther(reserve)} POT\nBalance: ${formatEther(balance)} POT\nGas reserve is an estimate, not the actual fee.`)
      if (balance < reserve) { setMessage(m => m + '\nInsufficient POT; no transaction sent.'); return }
      setPreview({ reviewer, requested, gasLimit, gasPrice, reserve, account })
    } catch (e) { setMessage('Check failed: ' + (e.shortMessage || e.message)) }
    finally { setBusy(false) }
  }

  async function send() {
    if (!preview || !agree || busy) return
    setBusy(true)
    try {
      await validateSelectedEvm(provider, account, walletKind)
      if (!same(account, preview.account) || !same(reviewer, preview.reviewer) || (action === 'grant') !== preview.requested) throw Error('Wallet, reviewer, or action changed. Recheck gas.')
      const [onChainAdmin, permission, gasPrice, balance] = await Promise.all([
        client.readContract({ address: contract, abi, functionName: 'admin' }),
        client.readContract({ address: contract, abi, functionName: 'reviewers', args: [preview.reviewer] }),
        client.getGasPrice(), client.getBalance({ address: account })
      ])
      if (!same(onChainAdmin, account) || permission === preview.requested) throw Error('Admin or reviewer permission changed. Refresh and recheck.')
      if (gasPrice > preview.gasPrice || balance < preview.reserve) throw Error('Gas price/balance changed. Recheck gas.')
      const required = await client.estimateContractGas({ address: contract, abi, functionName: 'setReviewer', args: [preview.reviewer, preview.requested], account })
      if (required > preview.gasLimit) throw Error('Required gas increased. Recheck gas.')
      const confirmed = window.confirm(`${preview.requested ? 'GRANT' : 'REVOKE'} reviewer access on V3 Testnet?\n\n${preview.reviewer}\nGas reserve: ${formatEther(preview.reserve)} POT\n\nYour wallet will request confirmation.`)
      if (!confirmed) return
      const wallet = createWalletClient({ chain, transport: custom(provider) })
      setMessage('Check and confirm the transaction in your wallet...')
      const hash = await wallet.writeContract({ chain, account, address: contract, abi, functionName: 'setReviewer', args: [preview.reviewer, preview.requested], gas: preview.gasLimit, gasPrice: preview.gasPrice })
      setMessage(`TX: ${hash}\nWaiting for receipt...`)
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 })
      const current = await client.readContract({ address: contract, abi, functionName: 'reviewers', args: [preview.reviewer] })
      setAuthorized(current)
      if (receipt.status === 'success') trackReviewer(preview.reviewer)
      setMessage(`TX: ${hash}\nBlock: ${receipt.blockNumber}\nGas used: ${receipt.gasUsed}\nReceipt: ${receipt.status}\nReviewer authorized: ${current}\n${receipt.status === 'success' && current === preview.requested ? 'ADMIN UPDATE SUCCESSFUL' : 'ADMIN UPDATE NOT CONFIRMED'}`)
      setPreview(null); setAgree(false)
    } catch (e) { setMessage(m => `${m}\nERROR: ${e.shortMessage || e.message}`) }
    finally { setBusy(false) }
  }

  return <div className="poc-admin-stack">
    <section className="ui-panel poc-panel-unified">
      <div className="ui-panel-head"><div><h2>Authorized Reviewers</h2><p>Known reviewer addresses, with permission checked directly on V3.</p></div><button className="ui-btn ui-outline" disabled={listLoading} onClick={() => loadList()}>{listLoading?'Loading…':'Refresh (free)'}</button></div>
      <div className="poc-admin-content">
        <p className="poc-footnote">This is a tracked list, not a complete chain-wide directory. Each status is checked on-chain. Click Revoke beside an authorized reviewer to see the estimated gas and confirm before your wallet signs.</p>
        {listError && <p role="alert" className="poc-error">{listError}</p>}
        {!list.length && <p className="ui-help">Press Refresh to load reviewer permissions.</p>}
        {list.filter(item => item.allowed).length === 0 && list.length > 0 && <p className="ui-help">No active reviewer found in the tracked addresses.</p>}
        {list.filter(item => item.allowed).map(item => <div className="poc-reviewer-row" key={item.address}>
          <div className="poc-reviewer-identity"><strong>{same(item.address,INITIAL_REVIEWERS[0]) ? 'PoC Reviewer' : 'Reviewer'}</strong><small>{item.address}</small></div>
          <span className="poc-status-chip is-authorized">Authorized</span>
          <button type="button" className="ui-btn poc-revoke-danger" disabled={!isAdmin || busy} onClick={() => revokeFromRow(item.address)}>Revoke</button>
        </div>)}
        {list.some(item => !item.allowed) && <div className="poc-revoked-history">
          <button type="button" className="ui-btn ui-outline" onClick={() => setShowRevoked(v => !v)} aria-expanded={showRevoked}>
            {showRevoked ? 'Hide' : 'Show'} revoked reviewers ({list.filter(item => !item.allowed).length})
          </button>
          {showRevoked && list.filter(item => !item.allowed).map(item => <div className="poc-reviewer-row" key={item.address}>
            <div className="poc-reviewer-identity"><strong>Previously tracked reviewer</strong><small>{item.address}</small></div>
            <span className="poc-status-chip">Revoked</span>
          </div>)}
        </div>}
      </div>
    </section>
    <section className="ui-panel poc-panel-unified">
      <div className="ui-panel-head"><div><h2>Grant New Reviewer</h2><p>Paste a new EVM wallet address below. To remove existing permissions, use Revoke directly in the list above.</p></div></div>
      <div className="ui-form poc-admin-content">
        <button className="ui-btn ui-outline" type="button" disabled={busy} onClick={refresh}>{busy?'Working…':'Check Admin Status (free)'}</button>
        <p className="ui-help">Connected: {account || 'No wallet'} · Admin permission: {admin ? (isAdmin ? 'YES' : 'NO') : 'Not checked'}</p>
        <label htmlFor="evm-admin-reviewer">Reviewer wallet address</label>
        <input id="evm-admin-reviewer" value={reviewer} onChange={e => {setReviewer(e.target.value.trim());setPreview(null);setAgree(false);setAuthorized(null)}} placeholder="0x..." />
        
        {authorized !== null && <p className="ui-help">Current permission: <strong>{authorized?'AUTHORIZED':'NOT AUTHORIZED'}</strong></p>}
        <button className="ui-btn ui-outline" type="button" disabled={busy || !isEvm} onClick={checkGas}>Check gas and permissions</button>
        <pre className="poc-admin-output">{message}</pre>
        <label className="poc-admin-agreement"><input type="checkbox" checked={agree} disabled={!preview || busy} onChange={e => setAgree(e.target.checked)}/>I understand this changes permissions on-chain and spends test POT.</label>
        <button className="ui-btn ui-primary" type="button" disabled={!preview || !agree || busy} onClick={send}>{action==='grant'?'Grant Reviewer on V3':'Revoke Reviewer on V3'}</button>
        <p className="ui-help">Revoking a reviewer does not undo earlier approvals. Contract permissions are always enforced on-chain.</p>
      </div>
    </section>
  </div>
}
