
import { network } from "hardhat";

const { viem } = await network.create({
  network: "portaldotV3",
});

const client = await viem.getPublicClient();

const chainId = await client.getChainId();
const blockNumber = await client.getBlockNumber();

console.log("Network: Portaldot V3 EVM Testnet");
console.log("Chain ID:", chainId);
console.log("Latest block:", blockNumber.toString());
console.log("Contract deployment: NOT STARTED");
