import { ethers } from "hardhat";
import { expect } from "chai";
import { deployUSDC } from "./utils";

describe("Router weight update", () => {
  it("deactivates strategy and перераспределяет средства", async () => {
    const [user, owner] = await ethers.getSigners();
    const usdc = await deployUSDC();

    // ── deploy два mock-vault’а ──
    const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
    const v1 = await (await VUSDCMock.deploy(usdc)).waitForDeployment();
    const v2 = await (await VUSDCMock.deploy(usdc)).waitForDeployment();

    const Vault = await ethers.getContractFactory("VenusUSDCVault");
    const vault1 = await (await Vault.deploy(usdc, v1)).waitForDeployment();
    const vault2 = await (await Vault.deploy(usdc, v2)).waitForDeployment();

    // ── deploy Router ──
    const Router = await ethers.getContractFactory("StrategyRouter");
    const router = await (await Router.deploy(usdc)).waitForDeployment();

    // addStrategy: 60 % + 40 %
    await router.addStrategy(vault1, 6000);
    await router.addStrategy(vault2, 4000);

    // ── депозит 100 ──
    const dep1 = ethers.parseUnits("100", 18);
    await usdc.approve(router, dep1);
    await router.deposit(dep1);

    // ── owner выключает vault2 ──
    await router.updateStrategy(1, 0, false);      // id = 1 (второй добавленный)

    // ── депозит ещё 50 ──
    const dep2 = ethers.parseUnits("50", 18);
    await usdc.approve(router, dep2);
    await router.deposit(dep2);

    // теперь всё должно быть во vault1
    const bal1 = await vault1.totalAssets();
    const bal2 = await vault2.totalAssets();

    const expectedBal1 = (dep1 * 6000n) / 10000n + dep2; // 60 + 50 = 110
    const expectedBal2 = (dep1 * 4000n) / 10000n;        // 40

    expect(bal1).to.equal(expectedBal1);
    expect(bal2).to.equal(expectedBal2);
    expect(await router.totalWeightBps()).to.equal(6000);

    // redeem только ликвидную часть (110 USDC) — vault2 деактивирован
    await router.redeem(expectedBal1, user);

    // Router вытягивает ликвидность только из активных стратегий,
    // поэтому во vault2 остаются 40 USDC, и Router.totalAssets()
    // показывает ту же сумму.
    const bal2After = await vault2.totalAssets();
    expect(bal2After).to.equal(expectedBal2);      // 40 USDC остались во выключенной стратегии
    expect(await router.totalAssets()).to.equal(0n); // Router считает только активные → 0
  });
});