import { createHash } from 'node:crypto'
import { isAddress, verifyMessage } from 'viem'
import { put } from '@vercel/blob'

const CATEGORIES = ['Community', 'Education', 'Development', 'Content', 'Design', 'Other']
const WINDOW_MS = 120000
const recent = new Map() // best-effort only; serverless instances do not share this map
const json = (res, code, body) => res.status(code).json(body)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required.' })
  const origin = (process.env.POC_APP_ORIGIN || 'https://pocledger.xyz').replace(/\/$/, '')
  if (req.headers.origin && req.headers.origin !== origin && !/^http:\/\/localhost:\d+$/.test(req.headers.origin)) {
    return json(res, 403, { error: 'Origin not allowed.' })
  }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (!b || typeof b !== 'object') throw Error('Invalid request.')
    const { title, category, description, evidenceUrl, address, signature, timestamp } = b
    if (![title, category, description, evidenceUrl].every(v => typeof v === 'string')) throw Error('Complete every field.')
    if (!title.trim() || title.length > 120 || !description.trim() || description.length > 400 || evidenceUrl.length > 500) throw Error('Invalid field length.')
    if (!CATEGORIES.includes(category)) throw Error('Invalid category.')
    const link = new URL(evidenceUrl)
    if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password) throw Error('Evidence URL must use HTTP(S).')
    if (!isAddress(address) || typeof signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(signature)) throw Error('Wallet authorization missing.')
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > WINDOW_MS) throw Error('Wallet signature expired. Check gas again.')

    const metadata = { version: 3, title: title.trim(), category, description: description.trim(), evidenceUrl: evidenceUrl.trim() }
    const exact = JSON.stringify(metadata, null, 2) + '\n'
    if (Buffer.byteLength(exact) > 16384) throw Error('Metadata too large.')
    const hash = '0x' + createHash('sha256').update(exact, 'utf8').digest('hex')
    const message = `PoC metadata upload on Portaldot V3\nWallet: ${address.toLowerCase()}\nSHA-256: ${hash}\nTimestamp: ${timestamp}\nNo blockchain transaction.`
    if (!(await verifyMessage({ address, message, signature }))) return json(res, 401, { error: 'Invalid wallet signature.' })

    // Pilot allowlist: wallet signatures alone do not stop arbitrary users from using your storage quota.
    const allowList = (process.env.POC_UPLOAD_ALLOWED_WALLETS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (!allowList.length) return json(res, 503, { error: 'Configure POC_UPLOAD_ALLOWED_WALLETS before enabling uploads.' })
    if (!allowList.includes(address.toLowerCase())) return json(res, 403, { error: 'Wallet is not on the allowed uploader list.' })
    const now = Date.now()
    const attempts = (recent.get(address.toLowerCase()) || []).filter(t => now - t < 60000)
    if (attempts.length >= 3) return json(res, 429, { error: 'Upload rate limit reached. Try again later.' })
    attempts.push(now)
    recent.set(address.toLowerCase(), attempts)
    if (recent.size > 1000) recent.clear()

    // Immutable, content-address-derived *pathname*. Do not overwrite an existing path.
    // Object bytes are exactly the same bytes that the frontend hashes.
    const blob = await put(`poc/metadata/${hash.slice(2)}.json`, exact, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json; charset=utf-8',
    })
    const parsed = new URL(blob.url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) throw Error('Unexpected Blob URL from upload.')
    return json(res, 200, { metadataUrl: blob.url, sha256: hash, bytes: Buffer.byteLength(exact) })
  } catch (e) {
    const message = e?.message || 'Blob upload failed.'
    // When metadata with this exact hash already exists, do not allow overwrites.
    return json(res, 400, { error: message })
  }
}
