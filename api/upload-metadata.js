import { createHash } from 'node:crypto'
import { isAddress, verifyMessage } from 'viem'
import { put, head } from '@vercel/blob'

const CATEGORIES = ['Community', 'Education', 'Development', 'Content', 'Design', 'Other']
const WINDOW_MS = 120000
const recent = new Map() // Best-effort only; instances do not share this map.
const json = (res, code, body) => res.status(code).json(body)
const sha256 = value => '0x' + createHash('sha256').update(value).digest('hex')

// Public uploads use shared, atomic Redis counters.
async function reservePublicUpload({ address, signature, req }) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { status: 503, error: 'Public uploads are not configured. Set Upstash Redis REST credentials.' }

  const forwarded = req.headers['x-forwarded-for']
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
  const digest = value => createHash('sha256').update(value).digest('hex')
  const day = Math.floor(Date.now() / 86400000)
  const keys = [
    `poc:v1:wallet:${day}:${address.toLowerCase()}`,
    `poc:v1:ip:${day}:${digest(ip)}`,
    `poc:v1:global:${day}`,
    `poc:v1:sig:${digest(signature)}`,
  ]
  const script = `
    if redis.call('EXISTS', KEYS[4]) == 1 then return 4 end
    if tonumber(redis.call('GET', KEYS[1]) or '0') >= tonumber(ARGV[1]) then return 1 end
    if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[2]) then return 2 end
    if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[3]) then return 3 end
    redis.call('SET', KEYS[4], '1', 'EX', 300)
    for i = 1, 3 do
      redis.call('INCR', KEYS[i])
      redis.call('EXPIRE', KEYS[i], 172800)
    end
    return 0
  `

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, 4, ...keys, 3, 12, 100]),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return { status: 503, error: 'Upload quota service unavailable. Please try later.' }
  }
  if (!response.ok) return { status: 503, error: 'Upload quota service rejected the request.' }
  let result
  try { result = await response.json() } catch {
    return { status: 503, error: 'Invalid response from quota service.' }
  }
  if (result.error || typeof result.result !== 'number') return { status: 503, error: 'Upload quota service error.' }
  if (result.result === 0) return null
  if (result.result === 4) return { status: 409, error: 'This wallet signature was already used. Check gas again.' }
  return { status: 429, error: 'Public upload quota reached (wallet: 3/day, network address: 12/day, community: 100/day). Try again tomorrow.' }
}

// Reuse an existing content-addressed Blob only after checking its exact bytes.
async function findExistingMetadata(pathname, exact, hash) {
  let existing
  try {
    existing = await head(pathname)
  } catch (error) {
    if (error?.name === 'BlobNotFoundError') return null
    throw error
  }

  const parsed = new URL(existing.url)
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname.endsWith('.public.blob.vercel-storage.com') ||
    existing.pathname !== pathname
  ) throw Error('Unexpected existing Blob metadata.')

  const response = await fetch(existing.url, {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  })
  if (!response.ok) throw Error('Cannot verify existing Blob.')

  const stored = Buffer.from(await response.arrayBuffer())
  const expected = Buffer.from(exact, 'utf8')
  if (!stored.equals(expected) || sha256(stored) !== hash) {
    throw Error('Existing Blob content does not match SHA-256.')
  }
  return existing
}

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
    const hash = sha256(Buffer.from(exact, 'utf8'))
    const message = `PoC metadata upload on Portaldot V3\nWallet: ${address.toLowerCase()}\nSHA-256: ${hash}\nTimestamp: ${timestamp}\nNo blockchain transaction.`
    if (!(await verifyMessage({ address, message, signature }))) return json(res, 401, { error: 'Invalid wallet signature.' })

    const mode = (process.env.POC_UPLOAD_MODE || 'allowlist').trim().toLowerCase()
    if (mode === 'public') {
      const rejected = await reservePublicUpload({ address, signature, req })
      if (rejected) return json(res, rejected.status, { error: rejected.error })
    } else if (mode === 'allowlist') {
      const allowList = (process.env.POC_UPLOAD_ALLOWED_WALLETS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      if (!allowList.length) return json(res, 503, { error: 'Configure POC_UPLOAD_ALLOWED_WALLETS before enabling uploads.' })
      if (!allowList.includes(address.toLowerCase())) return json(res, 403, { error: 'Wallet is not on the allowed uploader list.' })
      const now = Date.now()
      const attempts = (recent.get(address.toLowerCase()) || []).filter(t => now - t < 60000)
      if (attempts.length >= 3) return json(res, 429, { error: 'Upload rate limit reached. Try again later.' })
      attempts.push(now)
      recent.set(address.toLowerCase(), attempts)
      if (recent.size > 1000) recent.clear()
    } else {
      return json(res, 503, { error: 'Invalid POC_UPLOAD_MODE. Use allowlist or public.' })
    }

    // Immutable, content-addressed pathname. Never overwrite existing metadata.
    const pathname = `poc/metadata/${hash.slice(2)}.json`
    let blob = await findExistingMetadata(pathname, exact, hash)

    if (!blob) {
      try {
        blob = await put(pathname, exact, {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json; charset=utf-8',
        })
      } catch (error) {
        // Another request may have created the same Blob between head() and put().
        if (error?.name === 'BlobAlreadyExistsError' || /blob already exists/i.test(error?.message || '')) {
          blob = await findExistingMetadata(pathname, exact, hash)
          if (!blob) throw error
        } else {
          throw error
        }
      }
    }

    const parsed = new URL(blob.url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
      throw Error('Unexpected Blob URL from upload.')
    }
    return json(res, 200, { metadataUrl: blob.url, sha256: hash, bytes: Buffer.byteLength(exact) })
  } catch (e) {
    return json(res, 400, { error: e?.message || 'Blob upload failed.' })
  }
}
