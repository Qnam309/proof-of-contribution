// Same-origin read proxy for known public Blob URLs and legacy IPFS CIDs.
// Fixed hostname restrictions prevent the endpoint from fetching arbitrary URLs.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required.' })
  const blobUrl = typeof req.query.url === 'string' ? req.query.url : ''
  const cid = typeof req.query.cid === 'string' ? req.query.cid : ''
  let destination
  if (blobUrl) {
    try {
      const u = new URL(blobUrl)
      if (u.protocol !== 'https:' || u.port || u.username || u.password || !u.hostname.endsWith('.public.blob.vercel-storage.com') || !/^\/poc\/metadata\/[a-f0-9]{64}\.json$/.test(u.pathname) || u.search || u.hash) throw Error('Unsupported metadata Blob URL.')
      destination = u.href
    } catch { return res.status(400).json({ error: 'Invalid public PoC Blob URL.' }) }
  } else if (/^(bafy[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(cid)) {
    destination = `https://gateway.pinata.cloud/ipfs/${cid}`
  } else {
    return res.status(400).json({ error: 'Invalid metadata reference.' })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const upstream = await fetch(destination, { signal: controller.signal, redirect: 'error' })
    if (!upstream.ok) return res.status(502).json({ error: `Metadata host returned HTTP ${upstream.status}.` })
    if (Number(upstream.headers.get('content-length') || 0) > 16384) return res.status(413).json({ error: 'Metadata too large.' })
    const raw = new Uint8Array(await upstream.arrayBuffer())
    if (raw.length > 16384) return res.status(413).json({ error: 'Metadata too large.' })
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).send(Buffer.from(raw))
  } catch (e) {
    return res.status(502).json({ error: e.name === 'AbortError' ? 'Metadata download timed out.' : 'Cannot retrieve hosted metadata.' })
  } finally { clearTimeout(timer) }
}
