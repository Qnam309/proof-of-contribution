
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http
} from "viem";

import artifact from "./contributionRegistryArtifact.json";

const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const CHAIN_ID = 420420777;

const EXPECTED_ADDRESS =
  "0x50C7FAbAfE8716D19D31c3853589BADBD56541C2";

const chain = defineChain({
  id: CHAIN_ID,
  name: "Portaldot V3 EVM Testnet",
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

const publicClient = createPublicClient({
  chain,
  transport: http(RPC)
});

const $ = (id) => document.getElementById(id);

function getMetaMaskProvider() {
  const provider = window.ethereum;

  if (provider?.providers) {
    return provider.providers.find(
      (p) => p.isMetaMask && !p.isPortaldot
    ) || null;
  }

  return provider?.isMetaMask ? provider : null;
}

let walletClient = null;
let account = null;
let estimateInfo = null;
let busy = false;

const setText = (id, value) => {
  $(id).textContent = value;
};

function updateButtons() {
  $("connect").disabled = busy;
  $("estimate").disabled = busy || !account;
  $("deploy").disabled =
    busy ||
    !account ||
    !estimateInfo ||
    !$("agree").checked;
}

async function checkNetwork() {
  const networkHex = await getMetaMaskProvider().request({
    method: "eth_chainId"
  });

  const currentId = Number(BigInt(networkHex));

  if (currentId !== CHAIN_ID) {
    throw new Error(
      `Wrong network: ${currentId}. ` +
      `Select Portaldot V3 EVM Testnet (${CHAIN_ID}).`
    );
  }
}

async function checkAccount() {
  await checkNetwork();

  const addresses = await walletClient.getAddresses();
  const selected = addresses[0];

  if (!selected) {
    throw new Error("No wallet account selected.");
  }

  if (
    selected.toLowerCase() !==
    EXPECTED_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      "Please select your funded MetaMask account: " +
      EXPECTED_ADDRESS
    );
  }

  account = selected;
  return selected;
}

function resetEstimate() {
  estimateInfo = null;
  $("agree").checked = false;
  setText("cost", "Not estimated");
  updateButtons();
}

function formatPOT(wei) {
  return formatEther(wei) + " POT";
}

$("connect").addEventListener("click", async () => {
  try {
    busy = true;
    updateButtons();

    if (!getMetaMaskProvider()) {
      throw new Error(
        "MetaMask not found. Open this page in a " +
        "browser with MetaMask installed."
      );
    }

    walletClient = createWalletClient({
      chain,
      transport: custom(getMetaMaskProvider())
    });

    await walletClient.requestAddresses();
    await checkAccount();

    const balance = await publicClient.getBalance({
      address: account
    });

    setText(
      "wallet",
      `Connected: ${account}\n` +
      `Balance: ${formatPOT(balance)}`
    );

    resetEstimate();
  } catch (error) {
    account = null;
    resetEstimate();
    setText("wallet", "Error: " + error.message);
  } finally {
    busy = false;
    updateButtons();
  }
});

$("estimate").addEventListener("click", async () => {
  try {
    busy = true;
    resetEstimate();
    updateButtons();

    await checkAccount();

    setText("cost", "Estimating gas from V3 RPC...");

    if (
      !artifact.bytecode ||
      artifact.bytecode === "0x"
    ) {
      throw new Error("Contract bytecode is missing.");
    }

    const gasEstimated = await publicClient.estimateGas({
      account,
      data: artifact.bytecode,
      value: 0n
    });

    const gasPrice = await publicClient.getGasPrice();

    // Add 5% headroom above the estimated gas.
    const gasLimit =
      (gasEstimated * 105n + 99n) / 100n;

    const maxGasCost = gasLimit * gasPrice;

    const balance = await publicClient.getBalance({
      address: account
    });

    const costText =
      `Estimated gas: ${gasEstimated}\n` +
      `Gas limit (5% buffer): ${gasLimit}\n` +
      `Gas price: ${gasPrice} wei\n` +
      `Gas price × gas limit: ` +
      `${formatPOT(maxGasCost)}\n` +
      `Wallet balance: ${formatPOT(balance)}\n\n` +
      `This is a gas-cost calculation, ` +
      `not the confirmed final fee. ` +
      `Storage deposits or wallet fee changes ` +
      `may affect the amount required.`;

    setText("cost", costText);

    if (balance < maxGasCost) {
      throw new Error(
        "Insufficient POT for this gas-cost " +
        "calculation. Transaction is blocked."
      );
    }

    estimateInfo = {
      account,
      gasLimit,
      gasPrice,
      maxGasCost
    };

  } catch (error) {
    setText(
      "cost",
      $("cost").textContent +
      "\n\nERROR: " + error.message
    );
  } finally {
    busy = false;
    updateButtons();
  }
});

$("agree").addEventListener("change", updateButtons);

$("deploy").addEventListener("click", async () => {
  if (!estimateInfo || busy) return;

  try {
    busy = true;
    updateButtons();

    await checkAccount();

    if (
      account.toLowerCase() !==
      estimateInfo.account.toLowerCase()
    ) {
      throw new Error("Wallet account changed.");
    }

    const latestPrice = await publicClient.getGasPrice();

    if (latestPrice > estimateInfo.gasPrice) {
      throw new Error(
        "Gas price increased. Please run Check gas again."
      );
    }

    const balance = await publicClient.getBalance({
      address: account
    });

    if (balance < estimateInfo.maxGasCost) {
      throw new Error(
        "Balance is now too low. Check gas again."
      );
    }

    const confirmed = window.confirm(
      "DEPLOY ContributionRegistry on " +
      "Portaldot V3 Testnet?\n\n" +
      "Account: " + account + "\n" +
      "Gas limit: " + estimateInfo.gasLimit + "\n" +
      "Gas price: " + estimateInfo.gasPrice +
      " wei\n" +
      "Gas limit × gas price: " +
      formatPOT(estimateInfo.maxGasCost) +
      "\n\nThis can spend testnet POT. " +
      "You will still need to confirm in MetaMask."
    );

    if (!confirmed) return;

    setText(
      "result",
      "Requesting confirmation from MetaMask...\n" +
      "Carefully review the fee before confirming."
    );

    const hash = await walletClient.deployContract({
      chain,
      account,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      gas: estimateInfo.gasLimit,
      gasPrice: estimateInfo.gasPrice
    });

    setText(
      "result",
      `Transaction submitted!\n\n` +
      `TX Hash: ${hash}\n\n` +
      `Waiting for transaction receipt...`
    );

    const receipt =
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120000
      });

    setText(
      "result",
      `TX Hash: ${hash}\n` +
      `Status: ${receipt.status}\n` +
      `Block: ${receipt.blockNumber}\n` +
      `Contract Address: ` +
      `${receipt.contractAddress ?? "Not created"}\n` +
      `Gas used: ${receipt.gasUsed}\n\n` +
      (
        receipt.status === "success" &&
        receipt.contractAddress
          ? "DEPLOYMENT SUCCESSFUL"
          : "DEPLOYMENT NOT CONFIRMED AS SUCCESSFUL"
      )
    );

  } catch (error) {
    setText(
      "result",
      $("result").textContent +
      "\n\nERROR: " +
      (error.shortMessage || error.message)
    );
  } finally {
    busy = false;
    updateButtons();
  }
});

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => {
    account = null;
    resetEstimate();
    setText("wallet", "Account changed. Reconnect.");
  });

  window.ethereum.on("chainChanged", () => {
    account = null;
    resetEstimate();
    setText("wallet", "Network changed. Reconnect.");
  });
}

updateButtons();
