
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  defineChain,
  http
} from "viem";

const CONTRACT =
  "0x2719e83b13f737a4f3988b7e13ef028e93bb1cb2";

const RPC =
  "https://test-evm-rpc-v3.portaldot.dev";

const abi = JSON.parse(
  readFileSync(
    "./src/contributionRegistryAbi.json",
    "utf8"
  )
);

const chain = defineChain({
  id: 420420777,
  name: "Portaldot V3 Testnet",
  nativeCurrency: {
    name: "POT",
    symbol: "POT",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [RPC]
    }
  },
  testnet: true
});

const client = createPublicClient({
  chain,
  transport: http(RPC)
});

async function main() {
  console.log("=== PoC Registry V3 ===");

  const chainId = await client.getChainId();
  console.log("Chain ID:", chainId);

  const block = await client.getBlockNumber();
  console.log("Latest block:", block.toString());

  const code = await client.getCode({
    address: CONTRACT
  });

  if (!code || code === "0x") {
    throw new Error("Contract code not found!");
  }

  console.log("Contract:", CONTRACT);
  console.log("Bytecode exists: YES");

  const admin = await client.readContract({
    address: CONTRACT,
    abi,
    functionName: "admin"
  });

  console.log("Admin:", admin);

  const nextId = await client.readContract({
    address: CONTRACT,
    abi,
    functionName: "nextId"
  });

  console.log("Next contribution ID:", nextId.toString());

  console.log("=== READ TEST SUCCESS ===");
}

main().catch((error) => {
  console.error("ERROR:", error.shortMessage || error.message);
  process.exitCode = 1;
});
