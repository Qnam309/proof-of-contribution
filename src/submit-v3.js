
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http
} from "viem";

import abi from "./contributionRegistryAbi.json";
import { PORTALDOT_V3 } from "./contractConfig.js";

const RPC = PORTALDOT_V3.rpcUrl;
const CONTRACT = PORTALDOT_V3.contractAddress;

const chain = defineChain({
  id: PORTALDOT_V3.chainId,
  name: "Portaldot V3 Testnet",
  nativeCurrency: {
    name: "POT",
    symbol: "POT",
    decimals: 18
  },
  rpcUrls: {
    default: { http: [RPC] }
  },
  testnet: true
});

const client = createPublicClient({
  chain,
  transport: http(RPC)
});

const $ = (id) => document.getElementById(id);

let provider;
let walletClient;
let account;
let checked = null;
let busy = false;

function getMetaMask() {
  const eth = window.ethereum;

  if (Array.isArray(eth?.providers)) {
    return eth.providers.find(
      (p) => p.isMetaMask && !p.isPortaldot
    ) || null;
  }

  return eth?.isMetaMask ? eth : null;
}

function updateButtons() {
  $("connect").disabled = busy;
  $("estimate").disabled = busy || !account;
  $("submit").disabled =
    busy || !checked || !$("agree").checked;
}

function resetCheck() {
  checked = null;
  $("agree").checked = false;
  $("preview").textContent = "Not checked";
  updateButtons();
}

async function ensureAccount() {
  if (!provider || !walletClient) {
    throw new Error("Connect MetaMask first.");
  }

  const chainId = Number(
    BigInt(await provider.request({
      method: "eth_chainId"
    }))
  );

  if (chainId !== chain.id) {
    throw new Error(
      "Wrong network. Select Portaldot V3 Testnet."
    );
  }

  const addresses = await walletClient.getAddresses();

  if (!addresses[0] ||
      addresses[0].toLowerCase() !==
      account?.toLowerCase()) {
    throw new Error(
      "Wallet account changed. Reconnect."
    );
  }
}

async function makeHash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return "0x" + [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

$("connect").onclick = async () => {
  try {
    busy = true;
    updateButtons();

    provider = getMetaMask();

    if (!provider) {
      throw new Error(
        "MetaMask not found. Check your browser extensions."
      );
    }

    walletClient = createWalletClient({
      chain,
      transport: custom(provider)
    });

    const addresses = await walletClient.requestAddresses();
    account = addresses[0];

    await ensureAccount();

    const balance = await client.getBalance({
      address: account
    });

    $("wallet").textContent =
      `Connected: ${account}\n` +
      `Balance: ${formatEther(balance)} POT\n` +
      `Contract: ${CONTRACT}`;

    resetCheck();
  } catch (e) {
    account = null;
    $("wallet").textContent =
      "ERROR: " + (e.shortMessage || e.message);
    resetCheck();
  } finally {
    busy = false;
    updateButtons();
  }
};

$("evidence").addEventListener(
  "input",
  resetCheck
);

$("estimate").onclick = async () => {
  try {
    busy = true;
    resetCheck();
    updateButtons();

    await ensureAccount();

    const evidenceURI = $("evidence").value.trim();

    if (!/^https?:\/\/\S+$/i.test(evidenceURI)) {
      throw new Error(
        "Enter a valid http:// or https:// evidence URL."
      );
    }

    $("preview").textContent = "Checking gas...";

    const contentHash = await makeHash(evidenceURI);

    const nextId = await client.readContract({
      address: CONTRACT,
      abi,
      functionName: "nextId"
    });

    const args = [contentHash, evidenceURI];

    const gasEstimated =
      await client.estimateContractGas({
        address: CONTRACT,
        abi,
        functionName: "submitContribution",
        args,
        account
      });

    const gasLimit =
      (gasEstimated * 105n + 99n) / 100n;

    const gasPrice = await client.getGasPrice();

    const reserve = gasLimit * gasPrice;

    const balance = await client.getBalance({
      address: account
    });

    $("preview").textContent =
      `Contribution ID (expected): ${nextId}\n` +
      `Evidence: ${evidenceURI}\n` +
      `SHA-256: ${contentHash}\n\n` +
      `Estimated gas: ${gasEstimated}\n` +
      `Gas limit (+5%): ${gasLimit}\n` +
      `Gas price: ${gasPrice} wei\n` +
      `Gas cost estimate: ${formatEther(reserve)} POT\n` +
      `Wallet balance: ${formatEther(balance)} POT\n\n` +
      `Actual cost may differ.`;

    if (balance < reserve) {
      throw new Error(
        "Insufficient POT for the current estimate."
      );
    }

    checked = {
      account,
      evidenceURI,
      contentHash,
      gasLimit,
      gasPrice,
      reserve
    };

  } catch (e) {
    $("preview").textContent +=
      "\n\nERROR: " +
      (e.shortMessage || e.message);
  } finally {
    busy = false;
    updateButtons();
  }
};

$("agree").onchange = updateButtons;

$("submit").onclick = async () => {
  if (!checked || busy) return;

  try {
    busy = true;
    updateButtons();

    await ensureAccount();

    if (account.toLowerCase() !==
        checked.account.toLowerCase()) {
      throw new Error("Account changed.");
    }

    const currentPrice = await client.getGasPrice();

    if (currentPrice > checked.gasPrice) {
      throw new Error(
        "Gas price increased. Please check gas again."
      );
    }

    const balance = await client.getBalance({
      address: account
    });

    if (balance < checked.reserve) {
      throw new Error(
        "Balance too low. Please check gas again."
      );
    }

    const approved = window.confirm(
      "Submit contribution on Portaldot V3?\n\n" +
      "Evidence: " + checked.evidenceURI + "\n" +
      "SHA-256: " + checked.contentHash + "\n" +
      "Gas cost estimate: " +
      formatEther(checked.reserve) + " POT\n\n" +
      "MetaMask will request final confirmation."
    );

    if (!approved) return;

    $("result").textContent =
      "Opening MetaMask...";

    const hash = await walletClient.writeContract({
      chain,
      account,
      address: CONTRACT,
      abi,
      functionName: "submitContribution",
      args: [
        checked.contentHash,
        checked.evidenceURI
      ],
      gas: checked.gasLimit,
      gasPrice: checked.gasPrice
    });

    $("result").textContent =
      `TX submitted: ${hash}\n` +
      `Waiting for confirmation...`;

    const receipt =
      await client.waitForTransactionReceipt({
        hash,
        timeout: 120000
      });

    if (receipt.status !== "success") {
      throw new Error(
        `Transaction failed. TX: ${hash}`
      );
    }

    const nextId = await client.readContract({
      address: CONTRACT,
      abi,
      functionName: "nextId"
    });

    $("result").textContent =
      `SUBMIT SUCCESSFUL\n\n` +
      `TX Hash: ${hash}\n` +
      `Block: ${receipt.blockNumber}\n` +
      `Next contribution ID: ${nextId}\n` +
      `Evidence: ${checked.evidenceURI}\n` +
      `Content hash: ${checked.contentHash}\n\n` +
      `Save this TX Hash.`;

    resetCheck();

  } catch (e) {
    $("result").textContent +=
      "\n\nERROR: " +
      (e.shortMessage || e.message);
  } finally {
    busy = false;
    updateButtons();
  }
};

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => {
    account = null;
    resetCheck();
    $("wallet").textContent =
      "Account changed. Reconnect.";
  });

  window.ethereum.on("chainChanged", () => {
    account = null;
    resetCheck();
    $("wallet").textContent =
      "Network changed. Reconnect.";
  });
}

updateButtons();
