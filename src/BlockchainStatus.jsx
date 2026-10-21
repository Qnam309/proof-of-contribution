
import { useEffect, useState } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'

const RPC = 'wss://test-node-v3.portaldot.dev'

export default function BlockchainStatus({ account }) {
  const [status, setStatus] = useState('Connecting...')
  const [chain, setChain] = useState('—')
  const [block, setBlock] = useState('—')
  const [balance, setBalance] = useState('—')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let api

    async function connect() {
      try {
        setStatus('Connecting...')
        setError('')
        setBalance('—')

        const provider = new WsProvider(RPC, 1000)
        api = await ApiPromise.create({
          provider,
          throwOnConnect: true
        })

        if (cancelled) {
          await api.disconnect()
          return
        }

        const chainName = await api.rpc.system.chain()
        const header = await api.rpc.chain.getHeader()

        setChain(chainName.toString())
        setBlock(header.number.toString())
        setStatus('Connected')

        if (account) {
          const info = await api.query.system.account(account)
          const decimals = api.registry.chainDecimals[0] ?? 12
          const symbol = api.registry.chainTokens[0] ?? 'POT'
          const free = info.data.free.toBigInt()
          const unit = 10n ** BigInt(decimals)

          const whole = free / unit
          const fraction = (free % unit)
            .toString()
            .padStart(decimals, '0')
            .slice(0, 6)

          if (!cancelled) {
            setBalance(
              `${whole}.${fraction} ${symbol}`
            )
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('Connection failed')
          setError(err.message || String(err))
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (api) {
        api.disconnect().catch(console.error)
      }
    }
  }, [account])

  return (
    <section className="poc-section">
      <div className="section-heading">
        <h2>Live Blockchain Status</h2>
        <span>Portaldot V3 Testnet</span>
      </div>

      <p className="poc-description">
        Read-only blockchain connection. No tPOT required.
      </p>

      <div className="poc-record">
        <p><strong>RPC:</strong> {RPC}</p>
        <p><strong>Status:</strong> {status}</p>
        <p><strong>Chain:</strong> {chain}</p>
        <p><strong>Latest block at connection:</strong> {block}</p>
        <p><strong>Wallet balance:</strong> {account ? balance : 'Connect wallet first'}</p>

        {error && (
          <p style={{ color: '#ffb5bd', overflowWrap: 'anywhere' }}>
            Error: {error}
          </p>
        )}
      </div>

      <p className="poc-note">
        This section reads live chain data. Contribution
        submissions and approvals remain local demo records.
      </p>
    </section>
  )
}
