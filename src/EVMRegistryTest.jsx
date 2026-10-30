
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPublicClient, http } from "viem";
import {
  checkEVMNetwork,
  connectMetaMask,
  getRegistryInfo,
} from "./evmRegistry";
import registryAbi from "./contributionRegistryAbi.json";

const LOCAL_CONTRACT =
  "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";

const localClient = createPublicClient({
  transport: http("http://127.0.0.1:8545"),
});

const card = {
  background: "#151d30",
  border: "1px solid #303a57",
  padding: 24,
  borderRadius: 14,
  marginBottom: 20,
};

const button = {
  background: "#8057f5",
  border: 0,
  color: "white",
  padding: "12px 18px",
  borderRadius: 8,
  margin: "8px 8px 8px 0",
  cursor: "pointer",
};

function App() {
  const registry = getRegistryInfo();

  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState(null);
  const [local, setLocal] = useState(null);
  const [contributionId, setContributionId] = useState("1");
  const [contribution, setContribution] = useState(null);
  const [message, setMessage] = useState("");

  async function checkNetwork() {
    try {
      const result = await checkEVMNetwork(
        account ||
          "0x50C7FAbAfE8716D19D31c3853589BADBD56541C2"
      );
      setNetwork(result);
      setMessage("V3 network checked.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function connect() {
    try {
      const result = await connectMetaMask();
      setAccount(result.account);
      setMessage("MetaMask connected.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function checkLocal() {
    try {
      const chainId = await localClient.getChainId();
      const block = await localClient.getBlockNumber();
      const code = await localClient.getCode({
        address: LOCAL_CONTRACT,
      });

      if (!code || code === "0x") {
        throw new Error(
          "Contract not found. Deploy to Hardhat Local first."
        );
      }

      const admin = await localClient.readContract({
        address: LOCAL_CONTRACT,
        abi: registryAbi,
        functionName: "admin",
      });

      const nextId = await localClient.readContract({
        address: LOCAL_CONTRACT,
        abi: registryAbi,
        functionName: "nextId",
      });

      setLocal({
        chainId,
        block: block.toString(),
        admin,
        nextId: nextId.toString(),
      });

      setMessage("Local contract connected successfully.");
    } catch (error) {
      setMessage(error.shortMessage || error.message);
    }
  }

  async function loadContribution() {
    try {
      const id = BigInt(contributionId);

      if (id < 1n) {
        throw new Error("Contribution ID must be at least 1.");
      }

      const item = await localClient.readContract({
        address: LOCAL_CONTRACT,
        abi: registryAbi,
        functionName: "getContribution",
        args: [id],
      });

      const display = JSON.stringify(
        item,
        (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        2
      );

      setContribution(display);
      setMessage(`Contribution #${id} loaded from local blockchain.`);
    } catch (error) {
      setContribution(null);
      setMessage(error.shortMessage || error.message);
    }
  }

  return (
    <main
      style={{
        maxWidth: 850,
        margin: "40px auto",
        padding: 20,
        color: "#f5f5ff",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>PoC — EVM Registry Test</h1>
      <p style={{ color: "#a6b4d3" }}>
        Smart Contract Development Dashboard
      </p>

      <section style={card}>
        <h2>1. Portaldot V3 Testnet</h2>
        <p>Chain ID: {registry.chainId}</p>
        <button style={button} onClick={checkNetwork}>
          Check V3 Network
        </button>

        {network && (
          <>
            <p>Latest block: {network.blockNumber}</p>
            <p>Wallet balance: {network.balance} POT</p>
          </>
        )}
      </section>

      <section style={card}>
        <h2>2. MetaMask</h2>
        <p>{account || "Wallet not connected"}</p>
        <button style={button} onClick={connect}>
          Connect MetaMask (V3)
        </button>
      </section>

      <section style={card}>
        <h2>3. Hardhat Local Registry</h2>
        <p>Contract: {LOCAL_CONTRACT}</p>
        <p>ABI: {registry.functions.length} functions</p>

        <button style={button} onClick={checkLocal}>
          Check Local Contract
        </button>

        {local && (
          <>
            <p>Chain ID: {local.chainId}</p>
            <p>Latest block: {local.block}</p>
            <p>Admin: {local.admin}</p>
            <p>Next contribution ID: {local.nextId}</p>
          </>
        )}
      </section>

      <section style={card}>
        <h2>4. Explore On-chain Contributions</h2>
        <p>
          Read contribution records directly from the local
          Smart Contract.
        </p>

        <input
          type="number"
          min="1"
          value={contributionId}
          onChange={(event) =>
            setContributionId(event.target.value)
          }
          style={{
            background: "#0b1020",
            color: "white",
            border: "1px solid #39425f",
            padding: 12,
            borderRadius: 8,
            width: 140,
            marginRight: 10,
          }}
        />

        <button style={button} onClick={loadContribution}>
          Load Contribution
        </button>

        {contribution && (
          <pre
            style={{
              background: "#0b1020",
              padding: 16,
              borderRadius: 8,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: 13,
            }}
          >
            {contribution}
          </pre>
        )}
      </section>

      {message && (
        <p style={{ color: "#b8a1ff" }}>{message}</p>
      )}

      <p style={{ color: "#8894b5", fontSize: 13 }}>
        Development only. Read-only contract inspection.
        No transaction is sent by this page.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
