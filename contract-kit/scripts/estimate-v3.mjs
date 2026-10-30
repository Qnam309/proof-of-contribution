
import { readFileSync } from "node:fs";

const artifact = JSON.parse(
  readFileSync(
    "./artifacts/contracts/ContributionRegistry.sol/ContributionRegistry.json",
    "utf8"
  )
);

const rpc = "https://test-evm-rpc-v3.portaldot.dev";

const body = {
  jsonrpc: "2.0",
  id: 1,
  method: "eth_estimateGas",
  params: [
    {
      from: "0x50C7FAbAfE8716D19D31c3853589BADBD56541C2",
      data: artifact.bytecode,
      value: "0x0"
    }
  ]
};

try {
  const response = await fetch(rpc, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  console.log("Portaldot V3 Gas Estimation:");
  console.log(JSON.stringify(result, null, 2));

  if (result.result) {
    console.log("Estimated gas:", BigInt(result.result).toString());
  }
} catch (error) {
  console.error("RPC error:", error.message);
}
