
import { useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'

const RPC = 'wss://test-node-v3.portaldot.dev'
const STORAGE_KEY = 'poc-onchain-proofs-v1'

export default function PublishProof({ account, contributions }) {
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [proofs, setProofs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    } catch {
      return {}
    }
  })

  const approved = contributions.filter(
    item => item.status === 'Approved' && item.contributor === account
  )

  async function publish(item) {
    if (!account || busyId) return

    let api
    let unsubscribe

    setBusyId(item.id)
    setMessage('Preparing proof...')

    try {
      const provider = window.injectedWeb3?.['portaldot extension']

      if (!provider) {
        throw new Error('Portaldot Wallet extension not detected.')
      }

      const extension = await provider.enable('Proof of Contribution')
      const accounts = await extension.accounts.get()

      if (!accounts.some(a => a.address === account)) {
        throw new Error('Connected wallet account is not available.')
      }

      if (!extension.signer?.signPayload) {
        throw new Error('Wallet does not support Substrate transaction signing.')
      }

      api = await ApiPromise.create({
        provider: new WsProvider(RPC)
      })

      if (!api.tx.system.remarkWithEvent) {
        throw new Error('remarkWithEvent is unavailable on this chain.')
      }

      const proofData = JSON.stringify({
        app: 'Proof of Contribution',
        version: 1,
        contributionId: item.id,
        contributor: item.contributor,
        title: item.title,
        category: item.category,
        description: item.description,
        evidence: item.evidence,
        createdAt: item.createdAt
      })

      const bytes = new TextEncoder().encode(proofData)
      const digest = await crypto.subtle.digest('SHA-256', bytes)

      const proofHash = '0x' + Array.from(
        new Uint8Array(digest),
        b => b.toString(16).padStart(2, '0')
      ).join('')

      const tx = api.tx.system.remarkWithEvent(proofHash)

      const payment = await tx.paymentInfo(account)
      const decimals = api.registry.chainDecimals[0] ?? 12
      const symbol = api.registry.chainTokens[0] ?? 'POT'
      const estimatedFee = (
        Number(payment.partialFee.toString()) / 10 ** decimals
      ).toFixed(6)

      const confirmed = window.confirm(
        `Publish proof to Portaldot V3 Testnet?\n\n` +
        `Contribution: ${item.title}\n` +
        `Estimated fee: ${estimatedFee} ${symbol}\n\n` +
        `The wallet will ask you to sign this transaction.`
      )

      if (!confirmed) {
        setMessage('Transaction cancelled.')
        return
      }

      setMessage('Waiting for wallet signature...')

      await new Promise(async (resolve, reject) => {
        try {
          let finished = false

          const stop = async () => {
            if (unsubscribe) {
              unsubscribe()
              unsubscribe = null
            }
          }

          unsubscribe = await tx.signAndSend(
            account,
            { signer: extension.signer },
            async result => {
              if (finished) return

              if (result.dispatchError) {
                finished = true
                const err = result.dispatchError

                const detail = err.isModule
                  ? api.registry.findMetaError(err.asModule)
                  : null

                await stop()

                reject(new Error(
                  detail
                    ? `${detail.section}.${detail.name}`
                    : err.toString()
                ))
                return
              }

              if (result.status.isInBlock) {
                setMessage('Transaction included in a block. Waiting for finalization...')
              }

              if (result.status.isFinalized) {
                finished = true

                const failed = result.events.some(
                  ({ event }) =>
                    event.section === 'system' &&
                    event.method === 'ExtrinsicFailed'
                )

                await stop()

                if (failed) {
                  reject(new Error('Transaction failed on-chain.'))
                  return
                }

                const saved = {
                  contributionId: item.id,
                  proofHash,
                  txHash: tx.hash.toHex(),
                  blockHash: result.status.asFinalized.toHex(),
                  network: 'Portaldot V3 Testnet',
                  publishedAt: new Date().toISOString()
                }

                const updated = {
                  ...proofs,
                  [item.id]: saved
                }

                try {
                  localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(updated)
                  )
                  setProofs(updated)
                } catch {
                  // Transaction succeeded even if browser storage fails.
                }

                setMessage(
                  `Finalized successfully! Transaction: ${saved.txHash}`
                )

                resolve()
              }
            }
          )
        } catch (error) {
          reject(error)
        }
      })
    } catch (error) {
      console.error(error)
      setMessage(`Error: ${error.message || String(error)}`)
    } finally {
      if (unsubscribe) unsubscribe()
      if (api) await api.disconnect().catch(() => {})
      setBusyId('')
    }
  }

  return (
    <section className="poc-section" id="publish">
      <div className="section-heading">
        <h2>Publish Proof On-chain</h2>
        <span>Portaldot V3 Testnet</span>
      </div>

      <p className="poc-description">
        Publish the SHA-256 hash of an approved demo contribution
        using a real blockchain transaction. Approval itself is
        still local and is not independently authenticated.
      </p>

      {!account ? (
        <p className="poc-description">
          Connect your Portaldot Wallet first.
        </p>
      ) : approved.length === 0 ? (
        <p className="poc-description">
          No approved contributions available.
        </p>
      ) : (
        <div className="poc-records">
          {approved.map(item => {
            const proof = proofs[item.id]

            return (
              <article className="poc-record" key={item.id}>
                <h3>{item.title}</h3>
                <p className="poc-meta">Status: Approved (local demo)</p>

                {proof ? (
                  <>
                    <p style={{ overflowWrap: 'anywhere' }}>
                      <strong>Transaction hash:</strong> {proof.txHash}
                    </p>
                    <p style={{ overflowWrap: 'anywhere' }}>
                      <strong>Proof hash:</strong> {proof.proofHash}
                    </p>
                    <p className="poc-note">
                      Finalized on Portaldot V3 Testnet.
                      Blockchain verification UI is coming next.
                    </p>
                  </>
                ) : (
                  <button
                    className="poc-submit"
                    disabled={Boolean(busyId)}
                    onClick={() => publish(item)}
                  >
                    {busyId === item.id
                      ? 'Publishing...'
                      : 'Publish Proof On-chain'}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}

      {message && (
        <p
          className="poc-message"
          role="status"
          style={{ overflowWrap: 'anywhere' }}
        >
          {message}
        </p>
      )}
    </section>
  )
}
