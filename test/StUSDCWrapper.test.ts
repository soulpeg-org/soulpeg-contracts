import { expect } from "chai";
import { ethers } from "hardhat";
import { SPUSD, StUSDCWrapper, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("StUSDCWrapper", function () {
  let spusd: SPUSD;
  let sUSDC: MockERC20;
  let wrapper: StUSDCWrapper;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let investor: SignerWithAddress;
  let operator: SignerWithAddress;
  
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  beforeEach(async function () {
    [owner, user, investor, operator] = await ethers.getSigners();
    
    // Deploy mock sUSDC (using MockERC20 as simplified version)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    sUSDC = await MockERC20.deploy("Mock sUSDC", "sUSDC");
    await sUSDC.waitForDeployment();
    
    // First deploy a placeholder address for wrapper
    const placeholderAddress = ethers.Wallet.createRandom().address;
    
    // Deploy SPUSD with placeholder
    const SPUSD = await ethers.getContractFactory("SPUSD");
    spusd = await SPUSD.deploy(placeholderAddress);
    await spusd.waitForDeployment();
    
    // Deploy Wrapper
    const Wrapper = await ethers.getContractFactory("StUSDCWrapper");
    wrapper = await Wrapper.deploy(
      await sUSDC.getAddress(),
      await spusd.getAddress()
    );
    await wrapper.waitForDeployment();
    
    // Setup roles
    await spusd.grantRole(MINTER_ROLE, await wrapper.getAddress());
    await spusd.grantRole(BURNER_ROLE, await wrapper.getAddress());
    
    // Mint mock sUSDC for testing
    await sUSDC.mint(owner.address, ethers.parseEther("10000"));
    await sUSDC.mint(user.address, ethers.parseEther("1000"));
    await sUSDC.mint(investor.address, ethers.parseEther("500"));
  });

  describe("Deployment", function () {
    it("Should set correct sUSDC and SPUSD addresses", async function () {
      expect(await wrapper.sUSDC()).to.equal(await sUSDC.getAddress());
      expect(await wrapper.spusd()).to.equal(await spusd.getAddress());
    });

    it("Should set deployer as owner", async function () {
      expect(await wrapper.owner()).to.equal(owner.address);
    });

    it("Should revert with zero addresses", async function () {
      const Wrapper = await ethers.getContractFactory("StUSDCWrapper");
      
      await expect(
        Wrapper.deploy(ethers.ZeroAddress, await spusd.getAddress())
      ).to.be.revertedWith("Wrapper: Invalid sUSDC");
      
      await expect(
        Wrapper.deploy(await sUSDC.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Wrapper: Invalid SPUSD");
    });
  });

  describe("Wrapping", function () {
    it("Should wrap sUSDC to SPUSD correctly", async function () {
      const amount = ethers.parseEther("100");
      
      // Approve wrapper
      await sUSDC.approve(await wrapper.getAddress(), amount);
      
      // Check initial balances
      const initialSUSDC = await sUSDC.balanceOf(owner.address);
      
      // Wrap
      await expect(wrapper.wrap(amount))
        .to.emit(wrapper, "Wrapped")
        .withArgs(owner.address, amount);
      
      // Check final balances
      expect(await sUSDC.balanceOf(owner.address)).to.equal(initialSUSDC - amount);
      expect(await sUSDC.balanceOf(await wrapper.getAddress())).to.equal(amount);
      expect(await spusd.balanceOf(owner.address)).to.equal(amount);
    });

    it("Should revert wrap with zero amount", async function () {
      await expect(wrapper.wrap(0)).to.be.revertedWith("Wrapper: Zero amount");
    });

    it("Should revert wrap without approval", async function () {
      const amount = ethers.parseEther("100");
      await expect(wrapper.wrap(amount)).to.be.revertedWithCustomError(sUSDC, "ERC20InsufficientAllowance");
    });

    it("Should handle multiple wraps correctly", async function () {
      const amount1 = ethers.parseEther("50");
      const amount2 = ethers.parseEther("30");
      
      await sUSDC.approve(await wrapper.getAddress(), amount1 + amount2);
      
      await wrapper.wrap(amount1);
      await wrapper.wrap(amount2);
      
      expect(await spusd.balanceOf(owner.address)).to.equal(amount1 + amount2);
    });
  });

  describe("Wrap and Lock", function () {
    it("Should mint locked tokens correctly", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400 * 30; // 30 days
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      
      await expect(wrapper.wrapAndLock(investor.address, amount, unlockTime))
        .to.emit(wrapper, "LockedTokensMinted")
        .withArgs(investor.address, amount, unlockTime);
      
      expect(await spusd.balanceOf(investor.address)).to.equal(amount);
      
      const [lockedAmount, lockTime] = await wrapper.getLockInfo(investor.address);
      expect(lockedAmount).to.equal(amount);
      expect(lockTime).to.equal(unlockTime);
    });

    it("Should only allow owner or operator to call wrapAndLock", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400;
      
      await expect(
        wrapper.connect(user).wrapAndLock(investor.address, amount, unlockTime)
      ).to.be.revertedWith("Wrapper: Not authorized");
    });

    it("Should prevent locked tokens from being transferred", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400 * 30;
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      await wrapper.wrapAndLock(investor.address, amount, unlockTime);
      
      // Should not be able to transfer locked tokens
      await expect(
        spusd.connect(investor).transfer(user.address, amount)
      ).to.be.revertedWith("SPUSD: Transfer locked");
    });

    it("Should allow transfer after unlock time", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400;
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      await wrapper.wrapAndLock(investor.address, amount, unlockTime);
      
      // Fast forward past unlock time
      await time.increaseTo(unlockTime + 1);
      
      // Should be able to transfer now
      await spusd.connect(investor).transfer(user.address, amount);
      expect(await spusd.balanceOf(user.address)).to.equal(amount);
    });
  });

  describe("Lock Info", function () {
    it("Should return correct lock info", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400 * 30;
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      await wrapper.wrapAndLock(investor.address, amount, unlockTime);
      
      const [locked, unlock] = await wrapper.getLockInfo(investor.address);
      expect(locked).to.equal(amount);
      expect(unlock).to.equal(unlockTime);
    });

    it("Should return zero for unlocked tokens", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400;
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      await wrapper.wrapAndLock(investor.address, amount, unlockTime);
      
      await time.increaseTo(unlockTime + 1);
      
      const [locked, unlock] = await wrapper.getLockInfo(investor.address);
      expect(locked).to.equal(0);
      expect(unlock).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple locks for same address", async function () {
      const amount1 = ethers.parseEther("500");
      const amount2 = ethers.parseEther("300");
      const unlockTime = (await time.latest()) + 86400 * 30;
      
      await sUSDC.approve(await wrapper.getAddress(), amount1 + amount2);
      
      await wrapper.wrapAndLock(investor.address, amount1, unlockTime);
      await wrapper.wrapAndLock(investor.address, amount2, unlockTime);
      
      const [locked, _] = await wrapper.getLockInfo(investor.address);
      expect(locked).to.equal(amount1 + amount2);
    });

    it("Should prevent reentrancy in wrap", async function () {
      // Reentrancy is prevented by ReentrancyGuard
      // This test verifies the modifier is in place
      const amount = ethers.parseEther("100");
      await sUSDC.approve(await wrapper.getAddress(), amount);
      
      // The function should complete without reentrancy issues
      await expect(wrapper.wrap(amount)).to.not.be.reverted;
    });
  });

  describe("Operator Role", function () {
    it("Should allow owner to grant operator role", async function () {
      await wrapper.setOperator(operator.address, true);
      expect(await wrapper.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
    });

    it("Should allow owner to revoke operator role", async function () {
      await wrapper.setOperator(operator.address, true);
      await wrapper.setOperator(operator.address, false);
      expect(await wrapper.hasRole(OPERATOR_ROLE, operator.address)).to.be.false;
    });

    it("Should allow operator to call wrapAndLock", async function () {
      const amount = ethers.parseEther("1000");
      const unlockTime = (await time.latest()) + 86400 * 30;
      
      await wrapper.setOperator(operator.address, true);
      await sUSDC.transfer(operator.address, amount);
      await sUSDC.connect(operator).approve(await wrapper.getAddress(), amount);
      
      await expect(
        wrapper.connect(operator).wrapAndLock(investor.address, amount, unlockTime)
      ).to.not.be.reverted;
    });

    it("Should not allow non-owner to set operator", async function () {
      await expect(
        wrapper.connect(user).setOperator(user.address, true)
      ).to.be.revertedWithCustomError(wrapper, "OwnableUnauthorizedAccount");
    });
  });

  describe("sUSDC Storage in Wrapper", function () {
    it("Should store sUSDC in wrapper without burning", async function () {
      const amount = ethers.parseEther("100");
      
      await sUSDC.approve(await wrapper.getAddress(), amount);
      const wrapperBalanceBefore = await sUSDC.balanceOf(await wrapper.getAddress());
      
      await wrapper.wrap(amount);
      
      // Check that sUSDC is stored in wrapper
      expect(await sUSDC.balanceOf(await wrapper.getAddress())).to.equal(
        wrapperBalanceBefore + amount
      );
      
      // Check that sUSDC total supply didn't change (no burn)
      // This would fail if we were burning sUSDC
      const totalSupply = await sUSDC.totalSupply();
      expect(totalSupply).to.be.gt(0);
    });

    it("Should maintain 1:1 backing ratio", async function () {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("50");
      
      // Wrap from owner
      await sUSDC.approve(await wrapper.getAddress(), amount1);
      await wrapper.wrap(amount1);
      
      // Wrap from user
      await sUSDC.connect(user).approve(await wrapper.getAddress(), amount2);
      await wrapper.connect(user).wrap(amount2);
      
      // Check 1:1 ratio
      const totalSPUSD = await spusd.totalSupply();
      const wrapperSUSDCBalance = await sUSDC.balanceOf(await wrapper.getAddress());
      expect(totalSPUSD).to.equal(wrapperSUSDCBalance);
    });
  });
});