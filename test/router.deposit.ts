import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { deployUSDC, expectBigIntCloseTo } from "./utils";

describe("StrategyRouter – deposit split", () => {
  it("splits 1000 USDC by weights 70/30 + хвост", async () => {
    const [user] = await ethers.getSigners();
    const usdc = await deployUSDC();

    /* два mock-vault’а */
    const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
    const v1 = await VUSDCMock.deploy(usdc);
    const v2 = await VUSDCMock.deploy(usdc);

    const Vault = await ethers.getContractFactory("VenusUSDCVault");
    const vault1 = await Vault.deploy(usdc, v1);
    const vault2 = await Vault.deploy(usdc, v2);

    const Router = await ethers.getContractFactory("StrategyRouter");
    const router = await Router.deploy(usdc);

    /* add strategies */
    await router.addStrategy(vault1, 7000);  // 70 %
    await router.addStrategy(vault2, 3000);

    /* user deposit */
    const amt = ethers.parseUnits("1000", 18);
    await usdc.approve(router, amt);
    await router.deposit(amt);

    const bal1 = await vault1.totalAssets();
    const bal2 = await vault2.totalAssets();
    const reserve = await usdc.balanceOf(router);

    expect(bal1 + bal2 + reserve).to.equal(amt);
    // балансы в диапазоне ±1 wei из-за округления
    // Use our helper function for comparing bigint values
    expectBigIntCloseTo(bal1, ethers.parseUnits("700", 18));
    expectBigIntCloseTo(bal2 + reserve, ethers.parseUnits("300", 18));
  });
});