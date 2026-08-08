import hre from "hardhat";
const { ethers } = hre;
import { BigNumberish } from "ethers";
import { expect } from "chai";
import { ERC20Mock } from "../typechain-types";

/**
 * Helper function to safely compare bigint values with tolerance
 */
export function expectBigIntCloseTo(actual: BigNumberish, expected: BigNumberish, delta: number = 1): void {
  // Convert to numbers for comparison - this is safe for test amounts
  const actualNum = Number(actual.toString());
  const expectedNum = Number(expected.toString());
  expect(actualNum).to.be.closeTo(expectedNum, delta);
}

export async function deployUSDC(): Promise<ERC20Mock> {
  const [deployer] = await ethers.getSigners();
  const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
  const usdc = await ERC20Mock.deploy("USDC-Mock", "USDC", 18);
  await usdc.mint(deployer.address, ethers.parseUnits("1000000", 18));
  return usdc;
}