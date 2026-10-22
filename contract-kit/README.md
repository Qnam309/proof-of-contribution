# ContributionRegistry — local contract test kit

A standalone **Hardhat 3** project for the Proof of Contribution MVP. This folder has its own `package.json`, so it does **not** replace or alter the main React/Vite app.

## Local run (Windows PowerShell)

From the main project folder `C:\Users\Admin\proof-of-contribution`:

```powershell
cd contract-kit
npm.cmd install
npm.cmd run build
npm.cmd test
```

Expected: the Solidity contract compiles, and the suite runs 13 cases. **No wallet, tPOT or RPC is required**. Hardhat uses its local EVM simulation. Install may require an internet connection the first time to fetch packages and solc.

## Functions

- `setReviewer(address,bool)` — only the deployer/admin can grant or revoke reviewer permissions.
- `submitContribution(bytes32,string)` — store an immutable content hash and public evidence/metadata URI; no empty hash, no duplicate submission by the same user.
- `approveContribution(id)` and `rejectContribution(id)` — only appointed reviewers; the contributor cannot review their own item; decisions cannot be changed.
- `getContribution(id)` — read contributor, digest, URI, times, reviewer and status.
- `verifyContribution(id, expectedHash)` — true only for an approved contribution with the matching digest.

Status codes: `0=None`, `1=Pending`, `2=Approved`, `3=Rejected`.

## Scope and security limitations

- **Local prototype only**; not deployed to Portaldot V3 EVM and not yet connected to the React UI.
- This is a separate registry; it **does not automatically import or validate** the earlier Substrate `system.remarkWithEvent` proof.
- Reviewer appointment is centralized with a single admin. A reviewer may be compromised or dishonest; the registry proves which account decided, not that evidence is genuine.
- The hash format is a caller-chosen `bytes32`; the client must define a deterministic off-chain encoding/hash scheme (e.g. SHA-256 of canonical JSON) before integration. Do not put private personal data in public metadata/URI.
- A revoked reviewer does not retroactively invalidate an earlier approval. There is no appeal or revocation of contributions in this first version.
- Not independently audited. Test further before real assets, mainnet or production.

## Future integration

1. Confirm V3 EVM contract deployment and an EVM account with testnet gas.
2. Deploy the registry to the verified EVM chain and record address, chain ID and deployment tx hash.
3. Update the frontend to submit `bytes32` + public metadata URI and use on-chain reviewer authorization.
4. Add contract-based verification as a second verification path, retaining native Substrate `remark` proof verification for legacy examples.
