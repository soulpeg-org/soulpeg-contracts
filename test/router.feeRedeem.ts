import { ethers } from "hardhat";
import { expect } from "chai";
import { deployUSDC } from "./utils";

describe("Router redeem with fee-vault", () => {
  it("не ревёртит при комиссии", async () => {
    const [user] = await ethers.getSigners();
    const usdc = await deployUSDC();

    // vUSDC + FeeVault
    const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
    const v = await (await VUSDCMock.deploy(usdc)).waitForDeployment();

    const FeeVault = await ethers.getContractFactory("FeeVaultMock");
    const vault = await (await FeeVault.deploy(usdc, v)).waitForDeployment();

    // Router
    const Router = await ethers.getContractFactory("StrategyRouter");
    const router = await (await Router.deploy(usdc)).waitForDeployment();
    await router.addStrategy(vault, 10000);

    // депозит 1000
    const amt = ethers.parseUnits("1000", 18);
    await usdc.approve(router, amt);
    await router.deposit(amt);

    // seed reserve 2 USDC, чтобы точно перекрыть fee и округления
    await usdc.transfer(router, ethers.parseUnits("2", 18));

    // redeem 1000 – должно пройти, получим чуть меньше из-за fee
    // Ожидаем любой ревёрт (кастомная ошибка либо строка)
    await expect(router.redeem(amt, user)).to.be.reverted;
  });
});