import { expect } from "chai";
import { ethers } from "hardhat";
import { deployUSDC } from "./utils";

describe("Router vs approve-grief", () => {
  it("атака transferFrom не проходит", async () => {
    const [user, attacker] = await ethers.getSigners();
    const usdc = await deployUSDC();

    const Grief = await ethers.getContractFactory("GriefVaultMock");
    const griefVault = await Grief.deploy(usdc, attacker);

    const Router = await ethers.getContractFactory("StrategyRouter");
    const router = await Router.deploy(usdc);
    await router.addStrategy(griefVault, 10000);

    const amt = ethers.parseUnits("10", 18);
    await usdc.approve(router, amt);

    // Router даёт allowance ровно на 10 USDC, стратегия пытается снять 500 ether → revert
    await expect(router.deposit(amt)).to.be.reverted;

    // Атакер ничего не получил, в Router‑е тоже пусто (депозит не состоялся)
    expect(await usdc.balanceOf(attacker)).to.equal(0n);
    expect(await router.totalAssets()).to.equal(0n);
  });
});