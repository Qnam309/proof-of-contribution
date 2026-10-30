
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";

const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const CONTRACT =
  "0x2719e83b13f737a4f3988b7e13ef028e93bb1cb2";

const EVIDENCE =
  "https://github.com/Qnam309/proof-of-contribution";

const abi = JSON.parse(
  readFileSync("./src/contributionRegistryAbi.json", "utf8")
);

const client = createPublicClient({
  transport: http(RPC)
});

async function main() {
  const id = 1n;

  const contentHash =
    "0x" +
    createHash("sha256")
      .update(EVIDENCE, "utf8")
      .digest("hex");

  const contribution = await client.readContract({
    address: CONTRACT,
    abi,
    functionName: "getContribution",
    args: [id]
  });

  const verified = await client.readContract({
    address: CONTRACT,
    abi,
    functionName: "verifyContribution",
    args: [id, contentHash]
  });

  console.log("=== PoC V3 VERIFICATION ===");
  console.log("Contribution ID:", id.toString());
  console.log("Evidence:", EVIDENCE);
  console.log("Expected SHA-256:", contentHash);
  console.log(
    "On-chain record:",
    JSON.stringify(
      contribution,
      (_, value) =>
        typeof value === "bigint"
          ? value.toString()
          : value,
      2
    )
  );

  console.log("Verified:", verified);

  if (verified === true) {
    console.log("=== VERIFY SUCCESS ===");
  } else {
    console.log("=== VERIFICATION NOT PASSED ===");
  }
}

main().catch((error) => {
  console.error(
    "ERROR:",
    error.shortMessage || error.message
  );
  process.exitCode = 1;
});
