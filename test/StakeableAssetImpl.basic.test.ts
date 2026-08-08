import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("StakeableAssetImpl - Basic Tests", function () {
    let stakeableAsset: any;
    let usdc: any;
    let owner: any;
    let user1: any;
    let operator: any;

    const HOUR = 3600;
    const DAY = 24 * HOUR;
    const ZERO_ADDRESS = ethers.ZeroAddress;

    beforeEach(async function () {
        [owner, user1, operator] = await ethers.getSigners();
        
        // Deploy mock USDC
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        usdc = await ERC20Mock.deploy("USDC-Mock", "USDC", 18);
        
        // Deploy StakeableAssetImpl
        const StakeableAssetImpl = await ethers.getContractFactory("StakeableAssetImpl");
        stakeableAsset = await StakeableAssetImpl.deploy();
        
        // Initialize
        await stakeableAsset.initialize(
            await usdc.getAddress(),
            "Stakeable USDC", 
            "sUSDC"
        );

        // Set up operator role
        await stakeableAsset.setOperator(await operator.getAddress(), true);

        // Setup USDC
        const amount = ethers.parseUnits("10000", 18);
        await usdc.mint(await user1.getAddress(), amount);
        await usdc.connect(user1).approve(await stakeableAsset.getAddress(), amount);
    });

    it("Should initialize correctly", async function () {
        expect(await stakeableAsset.name()).to.equal("Stakeable USDC");
        expect(await stakeableAsset.symbol()).to.equal("sUSDC");
    });

    it("Should deposit and lock tokens", async function () {
        const depositAmount = ethers.parseUnits("1000", 18);
        
        const tx = await stakeableAsset.depositAndMint(
            await user1.getAddress(),
            depositAmount,
            30 * DAY
        );

        expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(depositAmount);
        expect(await stakeableAsset.totalStaked(await user1.getAddress())).to.equal(depositAmount);

        await expect(tx)
          .to.emit(stakeableAsset, "Deposited")
          .withArgs(await user1.getAddress(), depositAmount, anyValue);
    });

    it("Should prevent locked user from approving", async function () {
        // Deposit and lock
        await stakeableAsset.depositAndMint(
            await user1.getAddress(),
            ethers.parseUnits("1000", 18),
            30 * DAY
        );

        // Should not be able to approve while locked
        await expect(
            stakeableAsset.connect(user1).approve(
                await owner.getAddress(),
                ethers.parseUnits("100", 18)
            )
        ).to.be.revertedWith("Locked: approve disabled");
    });

    it("Should mint rewards correctly", async function () {
        const rewardAmount = ethers.parseUnits("100", 18);
        
        const tx = await stakeableAsset.rewardMint(
            await user1.getAddress(),
            rewardAmount,
            7 * DAY
        );

        expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(rewardAmount);
        expect(await stakeableAsset.totalRewardsDistributed()).to.equal(rewardAmount);
        
        // Check RewardsDistributed event
        await expect(tx)
          .to.emit(stakeableAsset, "RewardsDistributed")
          .withArgs(await user1.getAddress(), rewardAmount);
    });

    it("Should burn tokens and update statistics", async function () {
        // First deposit
        await stakeableAsset.depositAndMint(
            await user1.getAddress(),
            ethers.parseUnits("1000", 18),
            30 * DAY
        );

        const burnAmount = ethers.parseUnits("500", 18);
        const tx = await stakeableAsset.burn(await user1.getAddress(), burnAmount);

        const expectedBalance = ethers.parseUnits("500", 18);
        expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(expectedBalance);
        expect(await stakeableAsset.totalStaked(await user1.getAddress())).to.equal(expectedBalance);
        
        // Check StakedTokensBurned event
        await expect(tx)
          .to.emit(stakeableAsset, "StakedTokensBurned")
          .withArgs(await user1.getAddress(), burnAmount);
    });

    it("Should early redeem and return USDC", async function () {
        // First deposit
        await stakeableAsset.depositAndMint(
            await user1.getAddress(),
            ethers.parseUnits("1000", 18),
            30 * DAY
        );

        const initialBalance = await usdc.balanceOf(await user1.getAddress());
        const redeemAmount = ethers.parseUnits("500", 18);
        
        const tx = await stakeableAsset.earlyRedeem(await user1.getAddress(), redeemAmount);

        const expected = initialBalance + redeemAmount; // both bigint
        expect(await usdc.balanceOf(await user1.getAddress())).to.equal(expected);

        await expect(tx)
          .to.emit(stakeableAsset, "EarlyRedeemed")
          .withArgs(await user1.getAddress(), redeemAmount);
    });

    it("Should validate zero address in depositAndMint", async function () {
        const depositAmount = ethers.parseUnits("1000", 18);
        
        await expect(
            stakeableAsset.depositAndMint(
                ZERO_ADDRESS,
                depositAmount,
                30 * DAY
            )
        ).to.be.revertedWith("user=0");

        // zero address must also revert in rewardMint
        await expect(
            stakeableAsset.rewardMint(
                ZERO_ADDRESS,
                ethers.parseUnits("100", 18),
                7 * DAY
            )
        ).to.be.revertedWith("user=0");
    });

    it("Should auto‑unlock after full burn", async function () {
        // deposit 1 000 and lock for 30 days
        await stakeableAsset.depositAndMint(
            await user1.getAddress(),
            ethers.parseUnits("1000", 18),
            30 * DAY
        );

        // burn the entire balance
        await stakeableAsset.burn(
            await user1.getAddress(),
            ethers.parseUnits("1000", 18)
        );

        // balance zero → contract должен автоматически установить unlockAt = 1
        expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(0n);
        expect(
            await stakeableAsset.unlockAt(await user1.getAddress())
        ).to.equal(1);
    });
});
