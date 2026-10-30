
import { network } from "hardhat";

const { viem } = await network.create();

const registry = await viem.deployContract("ContributionRegistry");

console.log("ContributionRegistry deployed!");
console.log("Contract address:", registry.address);
