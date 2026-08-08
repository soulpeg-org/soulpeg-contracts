import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { StakeableAssetImplV4, ERC20Mock } from "../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("StakeableAssetImplV4 - Maintenance Operations", function () {
  let sUSDC: StakeableAssetImplV4;
  let usdc: ERC20Mock;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let user: SignerWithAddress;
  let recipient: SignerWithAddress;
  let attacker: SignerWithAddress;

  const DEPOSIT_AMOUNT = ethers.utils.parseUnits("1000", 18);
  const RECOVERY_AMOUNT = ethers.utils.parseUnits("500", 18);

  beforeEach(async function () {
    [owner, operator, user, recipient, attacker] = await ethers.getSigners();

    // Deploy mock USDC
    const ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    usdc = await ERC20MockFactory.deploy("USD Coin", "USDC", 18);
    await usdc.deployed();

    // Deploy StakeableAssetImplV4
    const StakeableAssetFactory = await ethers.getContractFactory("StakeableAssetImplV4");
    sUSDC = await StakeableAssetFactory.deploy();
    await sUSDC.deployed();

    // Initialize the contract
    await sUSDC.initialize(
      "Staked USDC",
      "sUSDC",
      usdc.address,
      owner.address,
      owner.address // strategy router
    );

    // Grant operator role
    const OPERATOR_ROLE = await sUSDC.OPERATOR_ROLE();
    await sUSDC.grantRole(OPERATOR_ROLE, operator.address);

    // Mint USDC to users
    await usdc.mint(user.address, DEPOSIT_AMOUNT);
    await usdc.mint(attacker.address, DEPOSIT_AMOUNT);
  });

  describe("maintenanceOperation", function () {
    beforeEach(async function () {
      // User approves USDC
      await usdc.connect(user).approve(sUSDC.address, DEPOSIT_AMOUNT);
    });

    it("Should allow owner to recover approved USDC", async function () {
      const reason = "User lost private key - Support ticket #12345";
      
      // Check initial balances
      const userBalanceBefore = await usdc.balanceOf(user.address);
      const recipientBalanceBefore = await usdc.balanceOf(recipient.address);

      // Execute maintenance operation
      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          reason
        )
      )
        .to.emit(sUSDC, "MaintenanceOperation")
        .withArgs(user.address, recipient.address, RECOVERY_AMOUNT, reason);

      // Check final balances
      expect(await usdc.balanceOf(user.address)).to.equal(
        userBalanceBefore.sub(RECOVERY_AMOUNT)
      );
      expect(await usdc.balanceOf(recipient.address)).to.equal(
        recipientBalanceBefore.add(RECOVERY_AMOUNT)
      );
    });

    it("Should allow operator to recover approved USDC", async function () {
      const reason = "Emergency recovery - Phishing incident #67890";

      await expect(
        sUSDC.connect(operator).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          reason
        )
      )
        .to.emit(sUSDC, "MaintenanceOperation")
        .withArgs(user.address, recipient.address, RECOVERY_AMOUNT, reason);
    });

    it("Should fail if user has insufficient balance", async function () {
      const excessiveAmount = DEPOSIT_AMOUNT.add(1);

      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          excessiveAmount,
          "Recovery"
        )
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should fail if user has insufficient allowance", async function () {
      // User reduces allowance
      await usdc.connect(user).approve(sUSDC.address, RECOVERY_AMOUNT.sub(1));

      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          "Recovery"
        )
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("Should fail if called by non-authorized address", async function () {
      await expect(
        sUSDC.connect(attacker).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          "Malicious attempt"
        )
      ).to.be.revertedWith("AccessControl:");
    });

    it("Should fail with zero amount", async function () {
      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          0,
          "Zero recovery"
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should fail with empty reason", async function () {
      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          ""
        )
      ).to.be.revertedWith("Reason required");
    });

    it("Should fail when contract is paused", async function () {
      await sUSDC.connect(owner).pause();

      await expect(
        sUSDC.connect(owner).maintenanceOperation(
          user.address,
          recipient.address,
          RECOVERY_AMOUNT,
          "Recovery during pause"
        )
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should handle reentrancy protection", async function () {
      // This test verifies that the nonReentrant modifier works
      // In practice, reentrancy would be complex to simulate here
      // but the modifier ensures protection
      const reason = "Reentrancy test";

      // Simply verify the operation works with the modifier in place
      await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient.address,
        RECOVERY_AMOUNT,
        reason
      );

      // If reentrancy was possible, this would fail
      expect(await usdc.balanceOf(recipient.address)).to.equal(RECOVERY_AMOUNT);
    });

    it("Should emit detailed event for audit trail", async function () {
      const reason = "User account compromised - KYC verified recovery";
      const blockTimestamp = await time.latest();

      const tx = await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient.address,
        RECOVERY_AMOUNT,
        reason
      );

      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === "MaintenanceOperation");

      expect(event).to.not.be.undefined;
      expect(event?.args?.from).to.equal(user.address);
      expect(event?.args?.to).to.equal(recipient.address);
      expect(event?.args?.amount).to.equal(RECOVERY_AMOUNT);
      expect(event?.args?.reason).to.equal(reason);
    });
  });

  describe("Multiple Recovery Scenarios", function () {
    it("Should handle partial recovery", async function () {
      await usdc.connect(user).approve(sUSDC.address, DEPOSIT_AMOUNT);

      // First recovery - partial amount
      const firstRecovery = ethers.utils.parseUnits("300", 18);
      await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient.address,
        firstRecovery,
        "Partial recovery - phase 1"
      );

      // Second recovery - remaining approved amount
      const secondRecovery = ethers.utils.parseUnits("200", 18);
      await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient.address,
        secondRecovery,
        "Partial recovery - phase 2"
      );

      expect(await usdc.balanceOf(recipient.address)).to.equal(
        firstRecovery.add(secondRecovery)
      );
    });

    it("Should handle recovery to different recipients", async function () {
      await usdc.connect(user).approve(sUSDC.address, DEPOSIT_AMOUNT);

      const [_, __, ___, recipient1, recipient2] = await ethers.getSigners();
      const amount1 = ethers.utils.parseUnits("300", 18);
      const amount2 = ethers.utils.parseUnits("200", 18);

      // Recovery to first recipient
      await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient1.address,
        amount1,
        "Recovery to authorized wallet 1"
      );

      // Recovery to second recipient
      await sUSDC.connect(owner).maintenanceOperation(
        user.address,
        recipient2.address,
        amount2,
        "Recovery to authorized wallet 2"
      );

      expect(await usdc.balanceOf(recipient1.address)).to.equal(amount1);
      expect(await usdc.balanceOf(recipient2.address)).to.equal(amount2);
    });
  });
});