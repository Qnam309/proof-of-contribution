
import { network, artifacts } from "hardhat";
import { sha256, toHex } from "viem";

const CONTRACT =
  "0x5fbdb2315678afecb367f032d93f642f64180aa3";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const wallets = await viem.getWalletClients();

const [admin, contributor, reviewer] = wallets;
const artifact = await artifacts.readArtifact("ContributionRegistry");
const abi = artifact.abi;

async function send(
  wallet: (typeof wallets)[number],
  functionName: string,
  args: readonly unknown[]
) {
  const hash = await wallet.writeContract({
    address: CONTRACT,
    abi,
    functionName,
    args,
    account: wallet.account,
    chain: wallet.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`${functionName} failed: ${hash}`);
  }

  console.log(`  Transaction: ${hash}`);
}

console.log("\n=== LOCAL REGISTRY WORKFLOW ===");
console.log("Admin:", admin.account.address);
console.log("Contributor:", contributor.account.address);
console.log("Reviewer:", reviewer.account.address);

// 1. Admin grants reviewer permission.
console.log("\nSTEP 1: Grant reviewer");
await send(admin, "setReviewer", [reviewer.account.address, true]);

// 2. Contributor submits a new contribution.
const contentHash = sha256(
  toHex(`PoC local workflow test ${Date.now()}`)
);

const nextId = await publicClient.readContract({
  address: CONTRACT,
  abi,
  functionName: "nextId",
}) as bigint;

console.log("\nSTEP 2: Submit contribution");
await send(contributor, "submitContribution", [
  contentHash,
  "https://github.com/Qnam309/proof-of-contribution",
]);

console.log("Contribution ID:", nextId.toString());

// 3. A different authorized reviewer approves.
console.log("\nSTEP 3: Approve contribution");
await send(reviewer, "approveContribution", [nextId]);

// 4. Independently verify using a read-only call.
console.log("\nSTEP 4: Verify contribution");
const verified = await publicClient.readContract({
  address: CONTRACT,
  abi,
  functionName: "verifyContribution",
  args: [nextId, contentHash],
});

console.log("Verified:", verified);
console.log(
  verified === true
    ? "\nSUCCESS: Submit -> Approve -> Verify"
    : "\nFAILED: Verification returned false"
);
