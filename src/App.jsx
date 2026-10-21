import BlockchainStatus from './BlockchainStatus'
import PublishProof from './PublishProof'
import VerifyOnChain from './VerifyOnChain'
import { useState } from 'react'
import {
  Wallet, ShieldCheck, FileCheck2,
  CheckCircle2, Send, ExternalLink,
  Search, XCircle
} from 'lucide-react'
import './App.css'

const STORAGE_KEY = 'poc-contributions-v1'

function loadContributions() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export default function App() {
  const [account, setAccount] = useState('')
  const [accountName, setAccountName] = useState('')
  const [walletStatus, setWalletStatus] = useState('Wallet not connected')
  const [loading, setLoading] = useState(false)

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Community')
  const [description, setDescription] = useState('')
  const [evidence, setEvidence] = useState('')
  const [message, setMessage] = useState('')

  const [contributions, setContributions] = useState(loadContributions)
  const [verifyId, setVerifyId] = useState('')
  const [verifyResult, setVerifyResult] = useState(null)

  async function connectWallet() {
    setLoading(true)
    setWalletStatus('Connecting to Portaldot Wallet...')

    try {
      const provider = window.injectedWeb3?.['portaldot extension']

      if (!provider) {
        setWalletStatus('Portaldot extension not detected.')
        return
      }

      const extension = await provider.enable('Proof of Contribution')
      const accounts = await extension.accounts.get()

      if (!accounts?.length) {
        setWalletStatus('No account available. Check website access permissions.')
        return
      }

      const selected = accounts.find(a => a.address.startsWith('5')) || accounts[0]

      setAccount(selected.address)
      setAccountName(selected.name || 'Portaldot Account')
      setWalletStatus('Wallet connected successfully')
    } catch (error) {
      console.error(error)
      setWalletStatus(error?.message || 'Failed to connect wallet')
    } finally {
      setLoading(false)
    }
  }

  function disconnectWallet() {
    setAccount('')
    setAccountName('')
    setWalletStatus('Disconnected from dashboard. Extension permission may remain active.')
  }

  function saveContributions(updated) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setContributions(updated)
      return true
    } catch {
      setMessage('Could not save data to this browser.')
      return false
    }
  }

  function submitContribution(event) {
    event.preventDefault()
    setMessage('')

    if (!account) {
      setMessage('Connect your wallet first.')
      return
    }

    if (!title.trim() || !description.trim() || !evidence.trim()) {
      setMessage('Please complete all required fields.')
      return
    }

    let url
    try {
      url = new URL(evidence.trim())
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      setMessage('Enter a valid evidence URL.')
      return
    }

    const contribution = {
      id: crypto.randomUUID(),
      title: title.trim(),
      category,
      description: description.trim(),
      evidence: url.href,
      contributor: account,
      createdAt: new Date().toISOString(),
      status: 'Pending Review',
      storage: 'Local demo only'
    }

    if (saveContributions([contribution, ...contributions])) {
      setTitle('')
      setCategory('Community')
      setDescription('')
      setEvidence('')
      setMessage('Contribution saved locally. Not submitted on-chain.')
    }
  }

  function reviewContribution(id, decision) {
    if (!account) {
      setMessage('Connect your wallet first.')
      return
    }

    const updated = contributions.map(item =>
      item.id === id && item.status === 'Pending Review'
        ? {
            ...item,
            status: decision,
            reviewedBy: account,
            reviewedAt: new Date().toISOString()
          }
        : item
    )

    if (saveContributions(updated)) {
      setVerifyResult(null)
      setMessage(
        `Demo review completed: ${decision}. This is not an on-chain approval.`
      )
    }
  }

  function verifyProof(event) {
    event.preventDefault()

    const id = verifyId.trim()
    const record = contributions.find(item => item.id === id)

    if (!record) {
      setVerifyResult({
        valid: false,
        text: 'No matching local record found. This does not check the blockchain.'
      })
      return
    }

    if (record.status === 'Approved') {
      setVerifyResult({
        valid: true,
        text: `Approved local demo record: ${record.title}. Reviewer: ${record.reviewedBy || 'Unknown'}. NOT an on-chain proof.`
      })
    } else {
      setVerifyResult({
        valid: false,
        text: `Record found, but its status is ${record.status}. No approved proof.`
      })
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Copied to clipboard.')
    } catch {
      setMessage('Unable to copy.')
    }
  }

  const myContributions = contributions.filter(
    item => item.contributor === account
  )

  const pendingContributions = contributions.filter(
    item => item.status === 'Pending Review'
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">PoC<span>.</span></div>
        <p className="brand-caption">PROOF OF CONTRIBUTION</p>

        <nav>
          <a className="active" href="#dashboard">Dashboard</a>
          <a href="#submit">Submit Contribution</a>
          <a href="#contributions">My Contributions</a>
          <a href="#review">Review & Approve</a>
          <a href="#verify">Verify Proof</a>
          <a href="#network">Network</a>
        </nav>

        <div className="sidebar-footer">
          Portaldot Hacker House 2026
          <small>Track 4 · Ecosystem DApps</small>
        </div>
      </aside>

      <main className="main" id="dashboard">
        <header className="topbar">
          <span>Proof of Contribution / Dashboard</span>

          <div className="wallet-actions">
            <button onClick={connectWallet} disabled={loading}>
              <Wallet size={17} />
              {loading
                ? 'Connecting...'
                : account
                  ? `${account.slice(0, 6)}...${account.slice(-4)}`
                  : 'Connect Portaldot Wallet'}
            </button>

            {account && (
              <button className="disconnect-button" onClick={disconnectWallet}>
                Disconnect
              </button>
            )}
          </div>
        </header>

        <section className="hero">
          <div className="eyebrow">
            PORTALDOT V3 · HACKER HOUSE 2026
          </div>

          <h1>
            Every contribution
            <br />
            <span>deserves proof.</span>
          </h1>

          <p>
            Turn meaningful community contributions into
            verifiable records that can be checked across applications.
          </p>

          <div className="hero-actions">
            <a href="#submit">Submit your contribution →</a>
            <span>One Action. One Proof. Two Applications.</span>
          </div>
        </section>

        <section className="section" id="workflow">
          <div className="section-heading">
            <h2>Contribution workflow</h2>
            <span>MVP · Local demo</span>
          </div>

          <div className="cards">
            <article className="card">
              <div className="card-icon"><FileCheck2 /></div>
              <span className="step">01 / SUBMIT</span>
              <h3>Submit contribution</h3>
              <p>Describe your contribution and provide supporting evidence.</p>
              <a href="#submit" className="poc-link">Try it now →</a>
            </article>

            <article className="card">
              <div className="card-icon"><ShieldCheck /></div>
              <span className="step">02 / REVIEW</span>
              <h3>Review & approve</h3>
              <p>Review evidence and make a demo approval decision.</p>
              <a href="#review" className="poc-link">Try it now →</a>
            </article>

            <article className="card">
              <div className="card-icon"><CheckCircle2 /></div>
              <span className="step">03 / VERIFY</span>
              <h3>Verify proof</h3>
              <p>Check the status of a locally saved contribution.</p>
              <a href="#verify" className="poc-link">Try it now →</a>
            </article>
          </div>
        </section>

        <section className="poc-section" id="submit">
          <div className="section-heading">
            <h2>Submit Contribution</h2>
            <span>Step 01</span>
          </div>

          <p className="poc-description">
            Share something useful you have done for a Web3 community.
          </p>

          <form className="poc-form" onSubmit={submitContribution}>
            <label htmlFor="title">Contribution title *</label>
            <input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Portaldot V3 Beginner Guide"
              maxLength={120}
              required
            />

            <label htmlFor="category">Category *</label>
            <select
              id="category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option>Community</option>
              <option>Education</option>
              <option>Development</option>
              <option>Content</option>
              <option>Other</option>
            </select>

            <label htmlFor="description">Description *</label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Describe your contribution..."
              required
            />

            <label htmlFor="evidence">Evidence URL *</label>
            <input
              id="evidence"
              type="url"
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
              placeholder="https://..."
              required
            />

            <p className="poc-note">
              Demo mode: data is saved in this browser only.
            </p>

            <button className="poc-submit" type="submit">
              <Send size={17} /> Submit Contribution
            </button>
          </form>
        </section>

        <section className="poc-section" id="contributions">
          <div className="section-heading">
            <h2>My Contributions</h2>
            <span>{account ? myContributions.length : 0} records</span>
          </div>

          {!account ? (
            <p className="poc-description">Connect your wallet to view your records.</p>
          ) : myContributions.length === 0 ? (
            <p className="poc-description">No contributions yet.</p>
          ) : (
            <div className="poc-records">
              {myContributions.map(item => (
                <article className="poc-record" key={item.id}>
                  <div className="poc-record-top">
                    <h3>{item.title}</h3>
                    <span className="poc-pending">{item.status}</span>
                  </div>

                  <p className="poc-meta">
                    {item.category} · {new Date(item.createdAt).toLocaleString()}
                  </p>

                  <p>{item.description}</p>

                  <a
                    className="poc-link"
                    href={item.evidence}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View evidence <ExternalLink size={14} />
                  </a>

                  <p className="poc-note">
                    Proof ID: {item.id}
                  </p>

                  <button
                    className="poc-action"
                    onClick={() => copyText(item.id)}
                  >
                    Copy Proof ID
                  </button>

                  <p className="poc-note">Local demo · Not on-chain</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="poc-section" id="review">
          <div className="section-heading">
            <h2>Review & Approve</h2>
            <span>Step 02 · Demo reviewer</span>
          </div>

          <p className="poc-description">
            Demo only: any connected wallet can review local records.
            Reviewer authorization is not implemented yet.
          </p>

          {pendingContributions.length === 0 ? (
            <p className="poc-description">No pending contributions.</p>
          ) : (
            <div className="poc-records">
              {pendingContributions.map(item => (
                <article className="poc-record" key={item.id}>
                  <div className="poc-record-top">
                    <h3>{item.title}</h3>
                    <span className="poc-pending">Pending Review</span>
                  </div>

                  <p>{item.description}</p>

                  <p className="poc-meta">
                    Contributor: {item.contributor}
                  </p>

                  <a
                    href={item.evidence}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="poc-link"
                  >
                    Review evidence <ExternalLink size={14} />
                  </a>

                  <div className="poc-review-actions">
                    <button
                      className="poc-approve"
                      onClick={() => reviewContribution(item.id, 'Approved')}
                      disabled={!account}
                    >
                      <CheckCircle2 size={16} /> Approve
                    </button>

                    <button
                      className="poc-reject"
                      onClick={() => reviewContribution(item.id, 'Rejected')}
                      disabled={!account}
                    >
                      <XCircle size={16} /> Reject
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="poc-section" id="verify">
          <div className="section-heading">
            <h2>Verify Proof</h2>
            <span>Step 03 · Local verification</span>
          </div>

          <p className="poc-description">
            Enter a Proof ID to check whether a local demo record was approved.
            This is not blockchain verification.
          </p>

          <form className="poc-form" onSubmit={verifyProof}>
            <label htmlFor="verify-id">Proof ID *</label>
            <input
              id="verify-id"
              value={verifyId}
              onChange={e => setVerifyId(e.target.value)}
              placeholder="Paste a Proof ID..."
              required
            />

            <button className="poc-submit" type="submit">
              <Search size={17} /> Verify Proof
            </button>
          </form>

          {verifyResult && (
            <div className="poc-verify-result">
              <strong>
                {verifyResult.valid
                  ? 'Approved demo record'
                  : 'Not verified'}
              </strong>
              <p>{verifyResult.text}</p>
            </div>
          )}
        </section>

        {message && (
          <p className="poc-message" role="status">{message}</p>
        )}

        <section className="network-panel" id="network">
          <div>
            <span className="eyebrow">WALLET CONNECTION</span>
            <h2>Portaldot Wallet</h2>
            <p>Target network: Portaldot V3</p>
            <p>Account: {accountName || 'Not connected'}</p>
            <p style={{ overflowWrap: 'anywhere' }}>
              Address: {account || 'Not connected'}
            </p>
            <p>Status: {walletStatus}</p>
            <p>Blockchain transactions: Not implemented yet</p>
          </div>

          <div className="wallet-actions">
            {account ? (
              <button onClick={() => copyText(account)}>Copy Address</button>
            ) : (
              <button onClick={connectWallet} disabled={loading}>
                <Wallet size={17} /> Connect Wallet
              </button>
            )}
          </div>
        </section>
        <PublishProof account={account} contributions={contributions} />
        <VerifyOnChain />
        <BlockchainStatus account={account} />
        <footer>
          Proof of Contribution · Prototype · 2026
        </footer>
      </main>
    </div>
  )
}
