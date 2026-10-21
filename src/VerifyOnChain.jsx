
import { useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Search, CheckCircle2, XCircle } from 'lucide-react'

const RPC = 'wss://test-node-v3.portaldot.dev'
const STORAGE_KEY = 'poc-onchain-proofs-v1'

function loadSavedProof() {
  try {
    const proofs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const entries = Object.values(proofs)
    return entries[entries.length - 1] || null
  } catch {
    return null
  }
}

export default function VerifyOnChain() {
  const saved = loadSavedProof()

  const [txHash, setTxHash] = useState(saved?.txHash || '')
  const [proofHash, setProofHash] = useState(saved?.proofHash || '')
  const [blockHash, setBlockHash] = useState(saved?.blockHash || '')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function verify(event) {
    event.preventDefault()
    setLoading(true)
    setResult(null)

    let api

    try {
      const hexPattern = /^0x[0-9a-fA-F]{64}$/

      if (
        !hexPattern.test(txHash.trim()) ||
        !hexPattern.test(proofHash.trim()) ||
        !hexPattern.test(blockHash.trim())
      ) {
        throw new Error(
          'Please enter valid transaction, proof and block hashes.'
        )
      }

      api = await ApiPromise.create({
        provider: new WsProvider(RPC)
      })

      const chain = (await api.rpc.system.chain()).toString()

      const signedBlock = await api.rpc.chain.getBlock(blockHash.trim())
      const extrinsics = signedBlock.block.extrinsics

      const index = extrinsics.findIndex(
        ext => ext.hash.toHex().toLowerCase() === txHash.trim().toLowerCase()
      )

      if (index === -1) {
        setResult({
          valid: false,
          message: 'Transaction not found in the specified block.'
        })
        return
      }

      const extrinsic = extrinsics[index]

      if (
        extrinsic.method.section !== 'system' ||
        extrinsic.method.method !== 'remarkWithEvent'
      ) {
        setResult({
          valid: false,
          message: 'Transaction exists, but is not system.remarkWithEvent.'
        })
        return
      }

      const onChainRemark = extrinsic.method.args[0]
        .toHex()
        .toLowerCase()

      if (onChainRemark !== proofHash.trim().toLowerCase()) {
        setResult({
          valid: false,
          message: 'Transaction found, but proof hash does not match.'
        })
        return
      }

      const events = await api.query.system.events.at(blockHash.trim())

      const txEvents = events.filter(record => {
        const phase = record.phase
        return (
          phase.isApplyExtrinsic &&
          phase.asApplyExtrinsic.toNumber() === index
        )
      })

      const successful = txEvents.some(
        record =>
          record.event.section === 'system' &&
          record.event.method === 'ExtrinsicSuccess'
      )

      const remarked = txEvents.some(
        record =>
          record.event.section === 'system' &&
          record.event.method === 'Remarked'
      )

      if (!successful || !remarked) {
        setResult({
          valid: false,
          message: 'Proof data matched, but success events were not confirmed.'
        })
        return
      }

      setResult({
        valid: true,
        message: 'Proof verified on Portaldot V3 Testnet.',
        chain,
        blockNumber: signedBlock.block.header.number.toString(),
        extrinsicIndex: index,
        signer: extrinsic.signer.toString(),
        transaction: extrinsic.hash.toHex(),
        proof: onChainRemark
      })
    } catch (error) {
      console.error(error)
      setResult({
        valid: false,
        message: error.message || String(error)
      })
    } finally {
      if (api) await api.disconnect().catch(() => {})
      setLoading(false)
    }
  }

  return (
    <section className="poc-section" id="verify-onchain">
      <div className="section-heading">
        <h2>Verify On-chain</h2>
        <span>Independent blockchain check</span>
      </div>

      <p className="poc-description">
        Verify a published proof directly against Portaldot V3.
        The transaction and its success events must match.
      </p>

      <form className="poc-form" onSubmit={verify}>
        <label htmlFor="onchain-tx">Transaction Hash</label>
        <input
          id="onchain-tx"
          value={txHash}
          onChange={e => setTxHash(e.target.value)}
          placeholder="0x..."
          required
        />

        <label htmlFor="onchain-proof">Proof Hash</label>
        <input
          id="onchain-proof"
          value={proofHash}
          onChange={e => setProofHash(e.target.value)}
          placeholder="0x..."
          required
        />

        <label htmlFor="onchain-block">Block Hash</label>
        <input
          id="onchain-block"
          value={blockHash}
          onChange={e => setBlockHash(e.target.value)}
          placeholder="0x..."
          required
        />

        <p className="poc-note">
          Saved proof values are loaded automatically when available.
          Block hash identifies the block containing the transaction.
        </p>

        <button className="poc-submit" type="submit" disabled={loading}>
          <Search size={17} />
          {loading ? 'Verifying...' : 'Verify On-chain'}
        </button>
      </form>

      {result && (
        <div className="poc-verify-result">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            {result.valid
              ? <CheckCircle2 color="#7ce5ac" />
              : <XCircle color="#ff9eae" />}

            <strong>
              {result.valid ? 'ON-CHAIN VERIFIED' : 'NOT VERIFIED'}
            </strong>
          </div>

          <p>{result.message}</p>

          {result.valid && (
            <>
              <p><strong>Chain:</strong> {result.chain}</p>
              <p><strong>Block:</strong> {result.blockNumber}</p>
              <p><strong>Extrinsic index:</strong> {result.extrinsicIndex}</p>

              <p style={{ overflowWrap: 'anywhere' }}>
                <strong>Signer:</strong> {result.signer}
              </p>

              <p style={{ overflowWrap: 'anywhere' }}>
                <strong>Transaction:</strong> {result.transaction}
              </p>

              <p style={{ overflowWrap: 'anywhere' }}>
                <strong>Proof:</strong> {result.proof}
              </p>

              <p className="poc-note">
                Blockchain inclusion and successful execution verified.
                This does not independently validate the contribution's
                quality or the reviewer's authority.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
