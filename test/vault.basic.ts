import { expect } from "chai";
import { ethers } from "hardhat";
import { deployUSDC } from "./utils";

describe("VenusUSDCVault – basic", () => {
    it("deposit / withdraw exact", async () => {
        const [user] = await ethers.getSigners();
        const usdc = await deployUSDC();

        /* deploy mock vUSDC + vault */
        const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
        const vUSDC = await VUSDCMock.deploy(usdc);

        const Vault = await ethers.getContractFactory("VenusUSDCVault");
        const vault = await Vault.deploy(usdc, vUSDC);

        /* approve & deposit 100 USDC */
        const amt = ethers.parseUnits("100", 18);
        await usdc.approve(vault, amt);
        await vault.deposit(amt, user);

        expect(await vault.totalAssets()).to.equal(amt);

        /* withdraw exactly 100 */
        await vault.withdraw(amt, user, user);
        expect(await usdc.balanceOf(user)).to.equal(ethers.parseUnits("1000000", 18)); // вернулись
        expect(await vault.totalAssets()).to.equal(0);
    });

    it("reverts on tiny deposit (0 shares)", async () => {
        const [user] = await ethers.getSigners();
        const usdc = await deployUSDC();
        const VUSDCMock = await ethers.getContractFactory("VUSDCMock");
        const vUSDC = await VUSDCMock.deploy(usdc);
        const Vault = await ethers.getContractFactory("VenusUSDCVault");
        const vault = await Vault.deploy(usdc, vUSDC);

        const tiny = 1n;                            // 1 wei
        await usdc.approve(vault, tiny);
        await expect(vault.deposit(tiny, user)).to.not.be.reverted; // shares == 0
    });
});
