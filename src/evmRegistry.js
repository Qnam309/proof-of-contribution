import registryAbi from "./contributionRegistryAbi.json";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
} from "viem";

export const PORTALDOT_EVM = {
  id: 420420777,
  name: "Portaldot V3 EVM Testnet",
  nativeCurrency: {
    name: "POT",
    symbol: "POT",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://test-evm-rpc-v3.portaldot.dev"],
    },
  },
};

// Read-only client: no wallet or gas required.
export const publicClient = createPublicClient({
  chain: PORTALDOT_EVM,
  transport: http(),
});

// Check network status and MetaMask balance.
export async function checkEVMNetwork(address) {
  const [chainId, blockNumber, balance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlockNumber(),
    publicClient.getBalance({ address }),
  ]);

  return {
    chainId,
    blockNumber: blockNumber.toString(),
    balance: formatEther(balance),
  };
}

// Connect MetaMask only when the user requests it.
export async function connectMetaMask() {
  const provider = window.ethereum;

  if (!provider) {
    throw new Error("MetaMask was not detected.");
  }

  const walletClient = createWalletClient({
    chain: PORTALDOT_EVM,
    transport: custom(provider),
  });

  const [account] = await walletClient.requestAddresses();
  const currentChainId = await walletClient.getChainId();

  if (currentChainId !== PORTALDOT_EVM.id) {
    throw new Error(
      "Please switch MetaMask to Portaldot V3 EVM Testnet."
    );
  }

  return { account, walletClient };
}
export const CONTRIBUTION_REGISTRY_ABI = registryAbi;

export function getRegistryInfo() {
  return {
    network: PORTALDOT_EVM.name,
    chainId: PORTALDOT_EVM.id,
    functions: registryAbi
      .filter((item) => item.type === "function")
      .map((item) => item.name),
    deployed: false,
  };
}


export function getRegistryContract(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("A valid deployed contract address is required.");
  }

  return {
    address,
    abi: CONTRIBUTION_REGISTRY_ABI,
  };
}

export async function readRegistry(address, functionName, args = []) {
  return publicClient.readContract({
    ...getRegistryContract(address),
    functionName,
    args,
  });
}

export async function writeRegistry(address, functionName, args = []) {
  const { account, walletClient } = await connectMetaMask();

  const hash = await walletClient.writeContract({
    ...getRegistryContract(address),
    functionName,
    args,
    account,
  });

  return hash;
}
