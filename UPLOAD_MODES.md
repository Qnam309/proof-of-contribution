# PoC Ledger upload access (Vercel Blob)

## Pilot / private testing (default)

Set `POC_UPLOAD_MODE=allowlist`, and `POC_UPLOAD_ALLOWED_WALLETS=0xWallet1,0xWallet2`.
This protects the Blob quota while testing; addresses not listed cannot submit metadata.

## Community public demo (opt-in)

1. Create a **Redis database that exposes Upstash-compatible REST** (Upstash Redis or Vercel Marketplace Upstash Redis).
2. In Vercel Project > Settings > Environment Variables set:
   - `POC_UPLOAD_MODE=public`
   - `UPSTASH_REDIS_REST_URL` (from the database dashboard)
   - `UPSTASH_REDIS_REST_TOKEN` (secret, server only)
   - Keep `BLOB_READ_WRITE_TOKEN`, `POC_APP_ORIGIN` and other existing server-side config.
3. Sync secrets for local `vercel dev` with `npx vercel env pull .env.local` **only on your own machine**, or enter them locally. Restart `vercel dev`.
4. Redeploy to activate production variables.
5. Test a new wallet, then verify that Submit > Check gas returns an uploaded JSON and a gas estimate.

Public quotas are enforced atomically across serverless instances: up to **3 metadata uploads/wallet/day**, **12/IP/day**, and **100 total/day**. Reuse of the same signed authorization is refused. Limits reset by UTC day. All successful reservations count even if Vercel Blob later fails, intentionally preferring quota safety over availability. An attacker with many IP addresses may still exhaust the total daily cap. Adjust numbers in `api/upload-metadata.js` as appropriate. Metadata is publicly readable and immutable; never include private information.

**Do not** remove the whitelist without setting up Redis-backed public mode. The server refuses public uploads when the rate-limit service is unavailable. Browser origin checks are not authentication; EVM signatures and centralized quota checks protect the upload endpoint. Blockchain fees and reviewer/admin permissions are unchanged.

Do not commit `.env.local` or expose `BLOB_READ_WRITE_TOKEN`, `UPSTASH_REDIS_REST_TOKEN`, or `VERCEL_OIDC_TOKEN` in screenshots or issue reports. Rotate any credentials accidentally exposed.
