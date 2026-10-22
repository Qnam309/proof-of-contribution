import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

export default defineConfig({
  plugins: [hardhatViem, hardhatViemAssertions, hardhatNodeTestRunner, hardhatNetworkHelpers],
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
});
