import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { deployUSDC } from "./utils";

describe("StrategyRouter – redeem logic", () => {
    it("uses reserve first, then pulls from vaults", async () => {
        const [user] = await ethers.getSigners();
        const usdc = await deployUSDC();

        /* vault */
        const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
        const v = await VUSDCMock.deploy(usdc);
        const Vault = await ethers.getContractFactory("VenusUSDCVault");
        const vault = await Vault.deploy(usdc, v);

        const Router = await ethers.getContractFactory("StrategyRouter");
        const router = await Router.deploy(usdc);
        await router.addStrategy(vault, 10000);

        /* seed reserve 50 USDC */
        await usdc.transfer(router, ethers.parseUnits("50", 18));

        /* deposit 100 USDC via router */
        const dep = ethers.parseUnits("100", 18);
        await usdc.approve(router, dep);
        await router.deposit(dep);

        /* redeem 120 USDC */
        const redeemAmt = ethers.parseUnits("120", 18);
        await router.redeem(redeemAmt, user);

        expect(await usdc.balanceOf(user)).to.equal(
            ethers.parseUnits("1000000", 18)         // старт
            - ethers.parseUnits("50", 18)          // seed-reserve
            - dep                                  // депозит 100
            + redeemAmt                            // вывод 120
        );

        expect(await router.totalAssets()).to.equal(
            dep + ethers.parseUnits("50", 18) - redeemAmt // 100 + 50 - 120 = 30
        );
    });
});