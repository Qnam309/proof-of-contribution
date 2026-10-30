
import { createPublicClient, http } from "viem";
import registryAbi from "./contributionRegistryAbi.json" with { type: "json" };

const CONTRACT =
  "0x5fbdb2315678afecb367f032d93f642f64180aa3";

const client = createPublicClient({
  transport: http("http://127.0.0.1:8545"),
});

try {
  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: CONTRACT });

  console.log("Network: Hardhat Local");
  console.log("Chain ID:", chainId);
  console.log("Latest block:", blockNumber.toString());
  console.log("Contract exists:", Boolean(code && code !== "0x"));

  const admin = await client.readContract({
    address: CONTRACT,
    abi: registryAbi,
    functionName: "admin",
  });

  const nextId = await client.readContract({
    address: CONTRACT,
    abi: registryAbi,
    functionName: "nextId",
  });

  console.log("Registry admin:", admin);
  console.log("Next contribution ID:", nextId.toString());
  console.log("Local Registry: READY");
} catch (error) {
  console.error("Local Registry error:", error.shortMessage || error.message);
}
