import { put, head, BlobNotFoundError } from '@vercel/blob'
import { createPublicClient, http, verifyMessage, isAddress } from 'viem'
import abi from '../src/contributionRegistryAbi.json' with { type: 'json' }

// Companion note only: ContributionRegistry records the decision, NOT the reason.
const CHAIN_ID = 420420777
const CONTRACT = '0x2719e83b13f737a4f3988b7e13ef028e93bb1cb2'
const RPC = 'https://test-evm-rpc-v3.portaldot.dev'
const client = createPublicClient({ transport: http(RPC, { timeout: 15000 }) })
const json = (res, code, body) => res.status(code).json(body)
const pathname = id => `poc/review-reasons/v1/${id}.json`
const messageFor = ({ id, reviewer, reason }) =>
  `PoC Ledger rejection reason\nChain ID: ${CHAIN_ID}\nContract: ${CONTRACT.toLowerCase()}\nContribution ID: ${id}\nReviewer: ${reviewer.toLowerCase()}\nReason: ${reason}`

async function getOnChain(id) {
  const nextId = await client.readContract({ address: CONTRACT, abi, functionName: 'nextId' })
  if (BigInt(id) < 1n || BigInt(id) >= nextId) return null
  return client.readContract({ address: CONTRACT, abi, functionName: 'getContribution', args: [BigInt(id)] })
}

async function existingNote(id) {
  let blob
  try { blob = await head(pathname(id)) }
  catch (e) { if (e instanceof BlobNotFoundError || e?.name === 'BlobNotFoundError') return null; throw e }
  const u = new URL(blob.url)
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.public.blob.vercel-storage.com') || blob.pathname !== pathname(id)) throw Error('Unexpected note location.')
  const response = await fetch(blob.url, { signal: AbortSignal.timeout(10000), cache: 'no-store' })
  if (!response.ok) throw Error('Could not read stored rejection reason.')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 4096) throw Error('Stored rejection reason is too large.')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

async function validatedNote(note, id, chainRecord) {
  if (!note || note.version !== 1 || note.id !== id || !isAddress(note.reviewer) ||
      typeof note.reason !== 'string' || note.reason.trim() !== note.reason ||
      note.reason.length < 10 || note.reason.length > 500 ||
      typeof note.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(note.signature)) return null
  if (Number(chainRecord?.status) !== 3 || chainRecord.reviewer.toLowerCase() !== note.reviewer.toLowerCase()) return null
  const verified = await verifyMessage({ address: note.reviewer, message: messageFor(note), signature: note.signature })
  return verified ? { reason: note.reason, reviewer: note.reviewer, signed: true, storage: 'off-chain', id } : null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'GET or POST required.' })
  const idRaw = req.method === 'GET' ? req.query.id : req.body?.id
  const id = String(idRaw || '')
  if (!/^[1-9]\d{0,14}$/.test(id)) return json(res, 400, { error: 'Invalid contribution ID.' })
  try {
    const record = await getOnChain(id)
    if (!record) return json(res, 404, { error: 'Contribution not found.' })
    if (Number(record.status) !== 3) return json(res, 404, { error: 'Contribution is not rejected.' })

    if (req.method === 'GET') {
      const note = await existingNote(id)
      if (!note) return json(res, 404, { error: 'No signed rejection note published.' })
      const checked = await validatedNote(note, id, record)
      return checked ? json(res, 200, checked) : json(res, 409, { error: 'Stored note failed verification.' })
    }

    // Origin is an auxiliary browser safeguard; signature + on-chain reviewer are the authorization.
    const expectedOrigin = (process.env.POC_APP_ORIGIN || 'https://pocledger.xyz').replace(/\/$/, '')
    const reqOrigin = req.headers.origin
    if (reqOrigin && reqOrigin !== expectedOrigin && !/^http:\/\/localhost:\d+$/.test(reqOrigin)) return json(res, 403, { error: 'Origin not allowed.' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const reason = body?.reason
    const reviewer = body?.reviewer
    const signature = body?.signature
    if (typeof reason !== 'string' || reason.trim() !== reason || reason.length < 10 || reason.length > 500 || !isAddress(reviewer)) {
      return json(res, 400, { error: 'Reason must be 10–500 characters, and reviewer must be a valid address.' })
    }
    if (record.reviewer.toLowerCase() !== reviewer.toLowerCase()) return json(res, 403, { error: 'Only the on-chain rejecting reviewer can publish a note.' })
    const candidate = { version: 1, id, reviewer, reason, signature }
    if (!(await validatedNote(candidate, id, record))) return json(res, 401, { error: 'Invalid reviewer signature.' })
    const prior = await existingNote(id)
    if (prior) {
      const checked = await validatedNote(prior, id, record)
      if (!checked) return json(res, 409, { error: 'Existing note failed verification.' })
      return prior.reason === reason && prior.signature === signature
        ? json(res, 200, { ...checked, reused: true })
        : json(res, 409, { error: 'A different signed reason already exists and cannot be overwritten.' })
    }
    try {
      await put(pathname(id), JSON.stringify(candidate), { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' })
    } catch (e) {
      if (e?.name === 'BlobAlreadyExistsError' || /already exists/i.test(e?.message || '')) {
        const existing = await existingNote(id)
        const checked = existing && await validatedNote(existing, id, record)
        if (checked && existing.reason === reason && existing.signature === signature) return json(res, 200, { ...checked, reused: true })
        return json(res, 409, { error: 'A different rejection reason was published first.' })
      }
      throw e
    }
    return json(res, 200, { reason, reviewer, signed: true, storage: 'off-chain', id })
  } catch (e) {
    return json(res, 503, { error: e?.message || 'Rejection reason service unavailable.' })
  }
}
