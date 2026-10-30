import { createPublicClient, defineChain, http } from 'viem'
import abi from './contributionRegistryAbi.json'
import { PORTALDOT_V3 } from './contractConfig.js'

export const registryAddress = PORTALDOT_V3.contractAddress
export const registryAbi = abi
export const registryChain = defineChain({
  id: PORTALDOT_V3.chainId,
  name: 'Portaldot V3 Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 18 },
  rpcUrls: { default: { http: [PORTALDOT_V3.rpcUrl] } },
  testnet: true
})
export const registryClient = createPublicClient({
  chain: registryChain,
  transport: http(PORTALDOT_V3.rpcUrl)
})

export const statusName = (status) => ({
  0: 'Unknown', 1: 'Pending Review', 2: 'Approved', 3: 'Rejected'
})[Number(status)] || `Unknown (${status})`

export async function validateSelectedEvm(provider, account, walletKind) {
  if (!provider || !account || !['metamask', 'okx'].includes(walletKind)) {
    throw Error('Connect MetaMask or OKX Wallet using Connect Wallet first.')
  }
  const chainId = Number(BigInt(await provider.request({ method: 'eth_chainId' })))
  if (chainId !== registryChain.id) throw Error('Select Portaldot V3 EVM Testnet (Chain ID 420420777).')
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (!accounts?.some(a => a.toLowerCase() === account.toLowerCase())) {
    throw Error('The connected account changed. Reconnect from Connect Wallet.')
  }
}

export async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return '0x' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function loadContribution(id) {
  const [nextId, contribution] = await Promise.all([
    registryClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'nextId' }),
    registryClient.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getContribution', args: [id] })
  ])
  if (id < 1n || id >= nextId) throw Error('Contribution ID does not exist on V3.')
  return contribution
}


// Compact, versioned metadata embedded in the existing contract evidenceURI string.
// Contract limit: evidenceURI <= 512 UTF-8 BYTES (not JavaScript characters).
// v1 was base64-encoded; keep read compatibility for already-stored v1 records.
const META_V1_PREFIX = 'poc:v1:'
const META_V2_PREFIX = 'poc:v2:'
export const EVIDENCE_URI_MAX_BYTES = 512
export function evidenceByteLength(value) {
  return new TextEncoder().encode(value).length
}
export function encodeProofMetadata({ title, category, description, evidenceUrl }) {
  const data = {
    v: 2,
    t: title.trim(),
    c: category,
    d: description.trim(),
    u: evidenceUrl.trim()
  }
  // JSON (no base64 overhead) keeps more room for user-supplied details.
  return META_V2_PREFIX + JSON.stringify(data)
}
export function parseProofEvidence(uri) {
  if (typeof uri !== 'string') return { isStructured: false, evidenceUrl: '', title: '', description: '', category: '' }
  if (!uri.startsWith(META_V1_PREFIX) && !uri.startsWith(META_V2_PREFIX)) {
    return { isStructured: false, evidenceUrl: uri, title: '', description: '', category: '' }
  }
  try {
    let data
    if (uri.startsWith(META_V2_PREFIX)) {
      data = JSON.parse(uri.slice(META_V2_PREFIX.length))
      if (data.v !== 2) throw Error('Invalid metadata version')
      data = { title: data.t, category: data.c, description: data.d, evidenceUrl: data.u }
    } else {
      const binary = atob(uri.slice(META_V1_PREFIX.length))
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (data.version !== 1) throw Error('Invalid metadata version')
    }
    if (['title','category','description','evidenceUrl'].some(k => typeof data[k] !== 'string')) throw Error('Invalid fields')
    const url = new URL(data.evidenceUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Invalid evidence URL')
    return { isStructured: true, title: data.title, category: data.category, description: data.description, evidenceUrl: data.evidenceUrl }
  } catch {
    return { isStructured: false, invalidMetadata: true, evidenceUrl: '', title: 'Invalid metadata', category: '', description: '' }
  }
}


// v3: only an HTTPS URL is stored in evidenceURI; SHA-256 commits to the
// exact UTF-8 bytes of the externally hosted JSON metadata (not the URL).
// Legacy plain-URL and poc:v1/v2: records retain their previous hashing rules.
export const EXTERNAL_META_PREFIX = 'poc:ext:v1:'
export const MAX_EXTERNAL_METADATA_BYTES = 16384
export const METADATA_CATEGORIES = ['Community', 'Education', 'Development', 'Content', 'Design', 'Other']
export function makeExternalMetadata({ title, category, description, evidenceUrl }) {
  return JSON.stringify({
    version: 3,
    title: title.trim(),
    category,
    description: description.trim(),
    evidenceUrl: evidenceUrl.trim()
  }, null, 2) + '\n'
}
export function validateExternalMetadataObject(obj) {
  if (!obj || Array.isArray(obj) || obj.version !== 3) throw Error('Not PoC metadata version 3.')
  for (const key of ['title', 'category', 'description', 'evidenceUrl']) {
    if (typeof obj[key] !== 'string' || !obj[key].trim()) throw Error(`Missing or invalid metadata field: ${key}`)
  }
  if (!METADATA_CATEGORIES.includes(obj.category)) throw Error('Unsupported category in external metadata.')
  if (obj.title.length > 120 || obj.description.length > 400) throw Error('Metadata title/description exceeds form limits.')
  const url = new URL(obj.evidenceUrl)
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('Invalid evidence URL in metadata.')
  return { isStructured: true, title: obj.title, category: obj.category, description: obj.description, evidenceUrl: obj.evidenceUrl }
}
export async function fetchExternalMetadata(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Metadata Raw URL must use HTTPS.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    // Public Blob and legacy IPFS metadata are fetched via the same-origin endpoint (no browser CORS problems).
    // Original metadata URL remains stored on-chain, independent of our app domain.
    const match = url.hostname === 'gateway.pinata.cloud' && /^\/ipfs\/(bafy[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.exec(url.pathname)
    const isBlob = url.hostname.endsWith('.public.blob.vercel-storage.com') && /^\/poc\/metadata\/[a-f0-9]{64}\.json$/.test(url.pathname)
    const fetchUrl = match ? `/api/metadata?cid=${encodeURIComponent(match[1])}` : isBlob ? `/api/metadata?url=${encodeURIComponent(url.toString())}` : url.toString()
    const response = await fetch(fetchUrl, { signal: controller.signal, cache: 'no-store', redirect: 'follow' })
    if (!response.ok) throw Error(`Metadata server returned HTTP ${response.status}.`)
    if (!match && !isBlob && new URL(response.url).protocol !== 'https:') throw Error('Metadata redirected outside HTTPS.')
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > MAX_EXTERNAL_METADATA_BYTES) throw Error('Remote metadata file is too large.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > MAX_EXTERNAL_METADATA_BYTES) throw Error('Remote metadata exceeds 16 KB.')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed = validateExternalMetadataObject(JSON.parse(content))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = '0x' + [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('')
    return { content, bytes: bytes.length, hash, metadata: parsed }
  } catch (error) {
    if (error.name === 'AbortError') throw Error('Metadata request timed out (12 seconds).')
    if (error instanceof TypeError) throw Error('Could not fetch metadata. Use a public HTTPS Raw URL with browser CORS enabled, e.g. gist.githubusercontent.com.')
    throw error
  } finally { clearTimeout(timeout) }
}
export async function resolveProofEvidence(uri, recordedHash) {
  if (typeof uri !== 'string' || !uri) throw Error('Missing on-chain evidence URI.')
  if (uri.startsWith(EXTERNAL_META_PREFIX)) {
    const rawUrl = uri.slice(EXTERNAL_META_PREFIX.length)
    const remote = await fetchExternalMetadata(rawUrl)
    if (remote.hash.toLowerCase() !== String(recordedHash).toLowerCase()) {
      throw Error('METADATA HASH MISMATCH: remote file has changed or does not match the blockchain. Do not approve this contribution.')
    }
    return { ...remote.metadata, isExternal: true, metadataUrl: rawUrl, hash: remote.hash, bytes: remote.bytes, integrityVerified: true }
  }
  const parsed = parseProofEvidence(uri)
  if (parsed.invalidMetadata) throw Error('Invalid on-chain metadata.')
  const hash = await sha256Text(uri)
  if (hash.toLowerCase() !== String(recordedHash).toLowerCase()) throw Error('On-chain evidence hash mismatch.')
  return { ...parsed, isExternal: false, metadataUrl: '', hash, integrityVerified: true }
}
