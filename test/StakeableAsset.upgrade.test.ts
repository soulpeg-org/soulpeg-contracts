import { ethers } from "hardhat";
import { expect } from "chai";
import { StakeableAssetImpl, ERC20Mock } from "../typechain-types";

const hre = require("hardhat");

describe("Upgrade flow", () => {
    let usdc: ERC20Mock;
    
    beforeEach(async () => {
        // Deploy mock USDC
        const MockUSDC = await ethers.getContractFactory("ERC20Mock");
        usdc = await MockUSDC.deploy("Mock USDC", "USDC", 6);
        await usdc.waitForDeployment();
    });

    it("preserves storage & logic", async () => {
        const [owner, alice] = await ethers.getSigners();
        
        // Mint USDC to alice for her deposit
        await usdc.mint(alice.address, ethers.parseUnits("2000", 6));
        
        // Deploy v1
        const ImplV1 = await ethers.getContractFactory("StakeableAssetImpl");
        const proxy = await hre.upgrades.deployProxy(
            ImplV1,
            [await usdc.getAddress(), "Stake USDC", "sUSDC"],
            { initializer: "initialize" }
        );
        
        const stakeableAsset = proxy as unknown as StakeableAssetImpl;

        // Owner approves and deposits for alice
        await usdc.connect(alice).approve(await stakeableAsset.getAddress(), ethers.parseUnits("1500", 6));
        await stakeableAsset.connect(owner).depositAndMint(alice.address, ethers.parseUnits("1000", 6), 30 * 86400);

        // Store initial values
        const initialBalance = await stakeableAsset.balanceOf(alice.address);
        const initialLockTime = await stakeableAsset.getRemainingLockTime(alice.address);
        const initialTotalSupply = await stakeableAsset.totalSupply();

        // Deploy v2 (same contract - simulating upgrade)
        const ImplV2 = await ethers.getContractFactory("StakeableAssetImpl");
        const upgraded = await hre.upgrades.upgradeProxy(await stakeableAsset.getAddress(), ImplV2);
        const upgradedStakeableAsset = upgraded as unknown as StakeableAssetImpl;

        // Verify storage preservation
        expect(await upgradedStakeableAsset.balanceOf(alice.address)).to.equal(initialBalance);
        expect(await upgradedStakeableAsset.getRemainingLockTime(alice.address)).to.be.gt(0);
        expect(await upgradedStakeableAsset.totalSupply()).to.equal(initialTotalSupply);
        
        // Verify roles after upgrade
        const DEFAULT_ADMIN_ROLE = await upgradedStakeableAsset.DEFAULT_ADMIN_ROLE();
        expect(await upgradedStakeableAsset.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
        
        // Test operator functionality after upgrade
        const [, , operator] = await ethers.getSigners();
        await upgradedStakeableAsset.connect(owner).setOperator(operator.address, true);
        
        // Need to approve USDC for the contract first
        await usdc.connect(alice).approve(await upgradedStakeableAsset.getAddress(), ethers.parseUnits("500", 6));
        
        // Operator should be able to call functions
        await expect(
            upgradedStakeableAsset.connect(operator).depositAndMint(alice.address, ethers.parseUnits("500", 6), 60 * 86400)
        ).to.not.be.reverted;
        
        // Verify functionality still works
        expect(await upgradedStakeableAsset.balanceOf(alice.address)).to.be.gt(initialBalance);
    });
});
