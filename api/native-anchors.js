import { put, list } from '@vercel/blob'
import { createPublicClient, http } from 'viem'
import { ApiPromise, WsProvider } from '@polkadot/api'
import abi from '../src/contributionRegistryAbi.json' with { type: 'json' }

// Public discovery index. NOT a token/wallet ownership claim or an approval service.
// Only finalized system.remarkWithEvent extrinsics whose SHA-256 matches an EVM
// contribution may be registered. Unified Verify independently rechecks all of it.
const CONTRACT = '0x2719e83b13f737a4f3988b7e13ef028e93bb1cb2'
const EVM_RPC = 'https://test-evm-rpc-v3.portaldot.dev'
const NATIVE_RPC = 'wss://test-node-v3.portaldot.dev'
const PREFIX = 'poc/native-anchors/v1/'
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const client = createPublicClient({ transport: http(EVM_RPC, { timeout: 12000 }) })
const reply = (res, code, obj) => res.status(code).json(obj)
const validId = x => /^[1-9]\d{0,14}$/.test(String(x))
const validBlock = x => HEX32.test(String(x)) || /^[1-9]\d*$/.test(String(x))
const safeBlobHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') } catch { return false } }

async function getEvm(id) {
  const [next, record] = await Promise.all([
    client.readContract({ address: CONTRACT, abi, functionName: 'nextId' }),
    client.readContract({ address: CONTRACT, abi, functionName: 'getContribution', args: [BigInt(id)] })
  ])
  if (BigInt(id) >= next) throw Error('Unknown EVM contribution ID.')
  return record
}

async function checkNative(txHash, block, contentHash) {
  let api
  try {
    api = await ApiPromise.create({ provider: new WsProvider(NATIVE_RPC) })
    if (!(await api.rpc.system.chain()).toString().toLowerCase().includes('portaldot')) throw Error('Unexpected native chain.')
    const hash = /^\d+$/.test(block) ? (await api.rpc.chain.getBlockHash(block)).toHex() : block
    const signed = await api.rpc.chain.getBlock(hash)
    const height = signed.block.header.number.toString()
    if ((await api.rpc.chain.getBlockHash(height)).toHex().toLowerCase() !== hash.toLowerCase()) throw Error('Noncanonical block.')
    const finalized = await api.rpc.chain.getHeader(await api.rpc.chain.getFinalizedHead())
    if (BigInt(height) > BigInt(finalized.number.toString())) throw Error('Not finalized.')
    const index = signed.block.extrinsics.findIndex(e => e.hash.toHex().toLowerCase() === txHash.toLowerCase())
    if (index < 0) throw Error('Native transaction not in block.')
    const ext = signed.block.extrinsics[index]
    if (ext.method.section !== 'system' || ext.method.method !== 'remarkWithEvent') throw Error('Not a remarkWithEvent.')
    if (ext.method.args[0].toHex().toLowerCase() !== contentHash.toLowerCase()) throw Error('Native hash differs from EVM record.')
    const events = (await api.query.system.events.at(hash)).filter(e => e.phase.isApplyExtrinsic && e.phase.asApplyExtrinsic.toNumber() === index)
    if (!events.some(e => e.event.section === 'system' && e.event.method === 'ExtrinsicSuccess') ||
      !events.some(e => e.event.section === 'system' && e.event.method === 'Remarked')) throw Error('Missing successful execution events.')
    return { blockHash: hash, blockNumber: height, signer: ext.signer.toString() }
  } finally { if (api) await api.disconnect().catch(() => {}) }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method)) return reply(res, 405, { error: 'GET or POST required.' })
  try {
    if (req.method === 'GET') {
      const anchors = []
      let cursor
      // Bounded public index. MVP scale; pagination can be added for >500 records.
      do {
        const page = await list({ prefix: PREFIX, limit: 100, ...(cursor ? { cursor } : {}) })
        for (const entry of page.blobs) {
          if (!safeBlobHost(entry.url)) continue
          try {
            const response = await fetch(entry.url, { signal: AbortSignal.timeout(8000) })
            if (!response.ok) continue
            const item = await response.json()
            if (validId(item.contributionId) && HEX32.test(item.contentHash) && HEX32.test(item.nativeTx) && validBlock(item.nativeBlock)) anchors.push(item)
          } catch { /* Skip unreadable entries */ }
        }
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor && anchors.length < 500)
      return reply(res, 200, { version: 1, anchors, partial: Boolean(cursor), note: 'Discovery hints. Unified verifier rechecks both chains.' })
    }
    const origin = req.headers.origin
    const allowed = (process.env.POC_APP_ORIGIN || 'https://pocledger.xyz').replace(/\/$/, '')
    if (origin && origin !== allowed && !/^http:\/\/localhost:\d+$/.test(origin)) return reply(res, 403, { error: 'Origin not allowed.' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const contributionId = String(body.contributionId || '')
    const contentHash = String(body.contentHash || '')
    const nativeTx = String(body.nativeTx || '')
    const nativeBlock = String(body.nativeBlock || '')
    if (!validId(contributionId) || !HEX32.test(contentHash) || !HEX32.test(nativeTx) || !validBlock(nativeBlock)) return reply(res, 400, { error: 'Invalid contribution ID / SHA-256 / native transaction / block.' })
    const record = await getEvm(contributionId)
    if (record.contentHash.toLowerCase() !== contentHash.toLowerCase()) return reply(res, 409, { error: 'EVM content hash mismatch.' })
    const checked = await checkNative(nativeTx, nativeBlock, contentHash)
    const pathname = `${PREFIX}${contributionId}/${nativeTx.toLowerCase()}.json`
    const entry = { contributionId, contentHash: record.contentHash, nativeTx: nativeTx.toLowerCase(), nativeBlock: checked.blockHash, nativeBlockNumber: checked.blockNumber, nativeSigner: checked.signer, version: 1 }
    try {
      await put(pathname, JSON.stringify(entry), { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' })
    } catch (e) {
      if (!(e?.name === 'BlobAlreadyExistsError' || /already exists/i.test(e?.message || ''))) throw e
    }
    return reply(res, 200, { indexed: true, contributionId, nativeTx: entry.nativeTx, nativeBlock: checked.blockHash })
  } catch (e) {
    const msg = e?.message || 'Native anchor service unavailable.'
    return reply(res, 503, { error: msg })
  }
}
