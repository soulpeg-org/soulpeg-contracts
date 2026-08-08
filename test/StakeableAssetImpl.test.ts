import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("StakeableAssetImpl", function () {
    let stakeableAsset: any;
    let usdc: any;
    let owner: Signer;
    let user1: Signer;
    let user2: Signer;
    let operator: Signer;
    let dex: Signer;
    let treasury: Signer;

    const HOUR = 3600;
    const DAY = 24 * HOUR;
    const ZERO_ADDRESS = ethers.ZeroAddress;

    beforeEach(async function () {
        [owner, user1, user2, operator, dex, treasury] = await ethers.getSigners();
        
        // Deploy mock USDC
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        usdc = await ERC20Mock.deploy("USDC-Mock", "USDC", 18);
        await usdc.mint(await owner.getAddress(), ethers.parseUnits("1000000", 18));
        
        // Deploy StakeableAssetImpl
        const StakeableAssetImpl = await ethers.getContractFactory("StakeableAssetImpl");
        stakeableAsset = await StakeableAssetImpl.deploy();
        
        // Initialize the contract
        await stakeableAsset.initialize(
            await usdc.getAddress(),
            "Stakeable USDC",
            "sUSDC"
        );

        // Set up operator role
        await stakeableAsset.setOperator(await operator.getAddress(), true);

        // Setup: Give users some USDC and approve the contract
        const amount = ethers.parseUnits("100000", 18);
        await usdc.mint(await user1.getAddress(), amount);
        await usdc.mint(await user2.getAddress(), amount);
        
        await usdc.connect(user1).approve(await stakeableAsset.getAddress(), amount);
        await usdc.connect(user2).approve(await stakeableAsset.getAddress(), amount);
    });

    describe("Initialization", function () {
        it("Should initialize correctly", async function () {
            expect(await stakeableAsset.name()).to.equal("Stakeable USDC");
            expect(await stakeableAsset.symbol()).to.equal("sUSDC");
            expect(await stakeableAsset.owner()).to.equal(await owner.getAddress());
            expect(await stakeableAsset.USDC()).to.equal(await usdc.getAddress());
        });

        it("Should not allow double initialization", async function () {
            await expect(
                stakeableAsset.initialize(
                    await usdc.getAddress(),
                    "Test",
                    "TEST"
                )
            ).to.be.reverted;            // v5 uses a custom error, generic revert is OK
        });
    });

    describe("Operator Role Management", function () {
        it("Should set operator role correctly", async function () {
            const OPERATOR_ROLE = await stakeableAsset.OPERATOR_ROLE();
            
            // Check operator was set in beforeEach
            expect(await stakeableAsset.hasRole(OPERATOR_ROLE, await operator.getAddress())).to.be.true;
            
            // Owner should have admin role
            const DEFAULT_ADMIN_ROLE = await stakeableAsset.DEFAULT_ADMIN_ROLE();
            expect(await stakeableAsset.hasRole(DEFAULT_ADMIN_ROLE, await owner.getAddress())).to.be.true;
        });

        it("Should allow owner to grant/revoke operator role", async function () {
            const OPERATOR_ROLE = await stakeableAsset.OPERATOR_ROLE();
            const newOperator = user2;
            
            // Grant role
            await stakeableAsset.setOperator(await newOperator.getAddress(), true);
            expect(await stakeableAsset.hasRole(OPERATOR_ROLE, await newOperator.getAddress())).to.be.true;
            
            // Revoke role
            await stakeableAsset.setOperator(await newOperator.getAddress(), false);
            expect(await stakeableAsset.hasRole(OPERATOR_ROLE, await newOperator.getAddress())).to.be.false;
        });

        it("Should not allow non-owner to set operator role", async function () {
            await expect(
                stakeableAsset.connect(user1).setOperator(await user2.getAddress(), true)
            ).to.be.reverted;
        });

        it("Should allow operator to call protected functions", async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            const lockPeriod = 30 * DAY;
            
            // User1 needs to approve USDC spending first
            await usdc.connect(user1).approve(await stakeableAsset.getAddress(), depositAmount);
            
            // Operator should be able to call depositAndMint
            await expect(
                stakeableAsset.connect(operator).depositAndMint(
                    await user1.getAddress(),
                    depositAmount,
                    lockPeriod
                )
            ).to.not.be.reverted;
        });

        it("Should allow operator to call rewardMint", async function () {
            const rewardAmount = ethers.parseUnits("100", 18);
            const lockPeriod = 30 * DAY;
            
            await expect(
                stakeableAsset.connect(operator).rewardMint(
                    await user1.getAddress(),
                    rewardAmount,
                    lockPeriod
                )
            ).to.not.be.reverted;
        });

        it("Should not allow non-operator to call protected functions", async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            const lockPeriod = 30 * DAY;
            
            await expect(
                stakeableAsset.connect(user1).depositAndMint(
                    await user2.getAddress(),
                    depositAmount,
                    lockPeriod
                )
            ).to.be.reverted;
        });
    });

    describe("Deposit and Mint", function () {
        it("Should deposit and mint tokens correctly", async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            const lockPeriod = 30 * DAY;

            const tx = await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                lockPeriod
            );

            expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(depositAmount);
            expect(await stakeableAsset.totalStaked(await user1.getAddress())).to.equal(depositAmount);
            expect(await stakeableAsset.totalUSDCDeposited()).to.equal(depositAmount);
            expect(await stakeableAsset.totalActiveStakers()).to.equal(1);

            // Check Deposited event
            await expect(tx)
              .to.emit(stakeableAsset, "Deposited")
              .withArgs(await user1.getAddress(), depositAmount, anyValue);
        });

        it("Should enforce lock period limits", async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            
            // Too short lock period
            await expect(
                stakeableAsset.depositAndMint(
                    await user1.getAddress(),
                    depositAmount,
                    30 * 60 // 30 minutes
                )
            ).to.be.revertedWith("lock");

            // Too long lock period  
            await expect(
                stakeableAsset.depositAndMint(
                    await user1.getAddress(),
                    depositAmount,
                    400 * DAY
                )
            ).to.be.revertedWith("lock");
        });

        it("Should enforce daily deposit limits", async function () {
            const largeAmount = ethers.parseUnits("15000000", 18); // > 10M limit
            
            // Mint more USDC to user1
            await usdc.mint(await user1.getAddress(), largeAmount);
            await usdc.connect(user1).approve(await stakeableAsset.getAddress(), largeAmount);

            await expect(
                stakeableAsset.depositAndMint(
                    await user1.getAddress(),
                    largeAmount,
                    DAY
                )
            ).to.be.revertedWith("deposit/day");
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
        });

        it("Should NOT shorten an existing longer lock", async function () {
            const firstAmount  = ethers.parseUnits("500", 18);
            const secondAmount = ethers.parseUnits("200", 18);
            const longLock     = 60 * DAY;      // 60‑day lock
            const shortLock    = 30 * DAY;      // 30‑day lock

            // first deposit with long lock
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                firstAmount,
                longLock
            );

            // travel 10 days forward
            await time.increase(10 * DAY);

            // second deposit with *shorter* lock
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                secondAmount,
                shortLock
            );

            // remaining lock time should still be close to (60‑10) days, **not** 30 days
            const remaining = await stakeableAsset.getRemainingLockTime(
                await user1.getAddress()
            );

            expect(remaining).to.be.greaterThan(49 * DAY); // > (60‑10‑1) buffer
        });
    });

    describe("Lock Management", function () {
        beforeEach(async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            const lockPeriod = 30 * DAY;

            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                lockPeriod
            );
        });

        it("Should prevent transfers while locked", async function () {
            const transferAmount = ethers.parseUnits("100", 18);

            await expect(
                stakeableAsset.connect(user1).transfer(
                    await user2.getAddress(),
                    transferAmount
                )
            ).to.be.revertedWith("locked");
        });

        it("Should prevent approvals while locked", async function () {
            const approveAmount = ethers.parseUnits("100", 18);

            await expect(
                stakeableAsset.connect(user1).approve(
                    await user2.getAddress(),
                    approveAmount
                )
            ).to.be.revertedWith("Locked: approve disabled");
        });

        it("Should allow unlock after lock period expires", async function () {
            // Fast forward time past lock period
            await time.increase(31 * DAY);

            await stakeableAsset.connect(user1).unlock();
            
            // Should now be able to transfer
            const transferAmount = ethers.parseUnits("100", 18);
            await expect(
                stakeableAsset.connect(user1).transfer(
                    await user2.getAddress(),
                    transferAmount
                )
            ).to.not.be.reverted;
        });

        it("Should not allow early unlock", async function () {
            await expect(
                stakeableAsset.connect(user1).unlock()
            ).to.be.revertedWith("locked");
        });
    });

    describe("DEX Integration", function () {
        beforeEach(async function () {
            // Whitelist DEX
            await stakeableAsset.setDex(await dex.getAddress(), true);
            
            // User deposits and gets unlocked
            const depositAmount = ethers.parseUnits("1000", 18);
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                HOUR
            );
            
            // Fast forward and unlock
            await time.increase(2 * HOUR);
            await stakeableAsset.connect(user1).unlock();
        });

        it("Should allow DEX trading when unlocked", async function () {
            const tradeAmount = ethers.parseUnits("100", 18);
            
            // User approves DEX
            await stakeableAsset.connect(user1).approve(
                await dex.getAddress(),
                tradeAmount
            );

            // DEX can transfer tokens
            await expect(
                stakeableAsset.connect(dex).transferFrom(
                    await user1.getAddress(),
                    await user2.getAddress(),
                    tradeAmount
                )
            ).to.not.be.reverted;
        });

        it("Should prevent DEX approval while locked", async function () {
            // Lock user again
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                ethers.parseUnits("500", 18),
                30 * DAY
            );

            const tradeAmount = ethers.parseUnits("100", 18);
            
            // Should not be able to approve DEX while locked
            await expect(
                stakeableAsset.connect(user1).approve(
                    await dex.getAddress(),
                    tradeAmount
                )
            ).to.be.revertedWith("Locked: approve disabled");
        });
    });

    describe("Reward Minting", function () {
        it("Should mint rewards to existing stakers", async function () {
            // First deposit
            const depositAmount = ethers.parseUnits("1000", 18);
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                30 * DAY
            );

            const initialBalance = await stakeableAsset.balanceOf(await user1.getAddress());
            const rewardAmount = ethers.parseUnits("50", 18);

            // Mint rewards (lockPeriodIfNew is ignored since user already has lock)
            const tx = await stakeableAsset.rewardMint(
                await user1.getAddress(),
                rewardAmount,
                7 * DAY
            );

            const expectedBalance = initialBalance + rewardAmount;
            expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(expectedBalance);
            expect(await stakeableAsset.totalRewardsDistributed()).to.equal(rewardAmount);

            // Check RewardsDistributed event
            await expect(tx)
              .to.emit(stakeableAsset, "RewardsDistributed")
              .withArgs(await user1.getAddress(), rewardAmount);
        });

        it("Should create lock for new reward recipients", async function () {
            const rewardAmount = ethers.parseUnits("100", 18);
            const lockPeriod = 7 * DAY;

            const tx = await stakeableAsset.rewardMint(
                await user1.getAddress(),
                rewardAmount,
                lockPeriod
            );

            expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(rewardAmount);
            expect(await stakeableAsset.getRemainingLockTime(await user1.getAddress()))
                .to.be.closeTo(lockPeriod, 60); // Within 1 minute tolerance

            // Check RewardsDistributed event
            await expect(tx)
              .to.emit(stakeableAsset, "RewardsDistributed")
              .withArgs(await user1.getAddress(), rewardAmount);
        });

        it("Should enforce daily mint limits", async function () {
            const largeAmount = ethers.parseUnits("15000000", 18); // > 10M limit

            await expect(
                stakeableAsset.rewardMint(
                    await user1.getAddress(),
                    largeAmount,
                    DAY
                )
            ).to.be.revertedWith("mint/day");
        });
    });

    describe("Burn and Early Redeem", function () {
        beforeEach(async function () {
            const depositAmount = ethers.parseUnits("1000", 18);
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                30 * DAY
            );
        });

        it("Should burn tokens and update statistics", async function () {
            const burnAmount = ethers.parseUnits("500", 18);
            const initialBalance = await stakeableAsset.balanceOf(await user1.getAddress());
            const initialSupply = await stakeableAsset.totalSupply();

            const tx = await stakeableAsset.burn(await user1.getAddress(), burnAmount);

            const expectedBalance = initialBalance - burnAmount;
            const expectedSupply = initialSupply - burnAmount;
            
            expect(await stakeableAsset.balanceOf(await user1.getAddress())).to.equal(expectedBalance);
            expect(await stakeableAsset.totalSupply()).to.equal(expectedSupply);
            expect(await stakeableAsset.totalStaked(await user1.getAddress()))
                .to.equal(ethers.parseUnits("500", 18));

            // Check StakedTokensBurned event
            await expect(tx)
              .to.emit(stakeableAsset, "StakedTokensBurned")
              .withArgs(await user1.getAddress(), burnAmount);
        });

        it("Should early redeem tokens and return USDC", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            const initialUsdcBalance = await usdc.balanceOf(await user1.getAddress());

            const tx = await stakeableAsset.earlyRedeem(await user1.getAddress(), redeemAmount);

            const expectedBalance = initialUsdcBalance + redeemAmount;
            expect(await usdc.balanceOf(await user1.getAddress())).to.equal(expectedBalance);
            expect(await stakeableAsset.totalStaked(await user1.getAddress()))
                .to.equal(ethers.parseUnits("500", 18));

            // Check EarlyRedeemed event
            await expect(tx)
              .to.emit(stakeableAsset, "EarlyRedeemed")
              .withArgs(await user1.getAddress(), redeemAmount);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set special addresses", async function () {
            await stakeableAsset.setSpecialAddress(await user1.getAddress(), true);
            expect(await stakeableAsset.isSpecialAddress(await user1.getAddress())).to.be.true;
        });

        it("Should allow owner to admin unlock users", async function () {
            // First lock a user
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                ethers.parseUnits("1000", 18),
                30 * DAY
            );

            await stakeableAsset.adminUnlock(await user1.getAddress());
            expect(await stakeableAsset.unlockAt(await user1.getAddress())).to.equal(1);
        });

        it("Should allow pausing and unpausing", async function () {
            await stakeableAsset.pause();
            expect(await stakeableAsset.paused()).to.be.true;

            await expect(
                stakeableAsset.depositAndMint(
                    await user1.getAddress(),
                    ethers.parseUnits("1000", 18),
                    DAY
                )
            ).to.be.reverted;            // Pausable now reverts with a custom error

            await stakeableAsset.unpause();
            expect(await stakeableAsset.paused()).to.be.false;
        });

        it("Should allow USDC sweep to treasury", async function () {
            // First deposit some USDC
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                ethers.parseUnits("1000", 18),
                DAY
            );

            const sweepAmount = ethers.parseUnits("500", 18);
            const initialTreasuryBalance = await usdc.balanceOf(await treasury.getAddress());

            await stakeableAsset.sweepUSDC(await treasury.getAddress(), sweepAmount);

            expect(await usdc.balanceOf(await treasury.getAddress()))
                .to.equal(initialTreasuryBalance + sweepAmount);
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                ethers.parseUnits("1000", 18),
                30 * DAY
            );
        });

        it("Should return correct user info", async function () {
            const userInfo = await stakeableAsset.getUserInfo(await user1.getAddress());
            expect(userInfo.isLocked).to.be.true;
            expect(userInfo.totalBalance).to.equal(ethers.parseUnits("1000", 18));
            expect(userInfo.stakedAmount).to.equal(ethers.parseUnits("1000", 18));
            expect(userInfo.remainingTime).to.be.closeTo(30 * DAY, 60);
        });

        it("Should return correct protocol stats", async function () {
            const stats = await stakeableAsset.getProtocolStats();
            expect(stats.totalSupply_).to.equal(ethers.parseUnits("1000", 18));
            expect(stats.totalDeposited).to.equal(ethers.parseUnits("1000", 18));
            expect(stats.activeStakers).to.equal(1);
            expect(stats.isPaused_).to.be.false;
        });

        it("Should return available actions correctly", async function () {
            const actions = await stakeableAsset.getAvailableActions(await user1.getAddress());
            expect(actions.canTransfer).to.be.false;
            expect(actions.canApprove).to.be.false;
            expect(actions.canUnlock).to.be.false;
            expect(actions.canTradeOnDex).to.be.false;
        });

        it("Should calculate APY estimate", async function () {
            // Add some rewards to calculate APY
            await stakeableAsset.rewardMint(
                await user1.getAddress(),
                ethers.parseUnits("100", 18),
                DAY
            );

            const apy = await stakeableAsset.estimateAPY(await user1.getAddress());
            expect(apy).to.be.greaterThan(0);
        });
    });

    describe("Security Tests", function () {
        it("Should prevent non-owner from calling admin functions", async function () {
            await expect(
                stakeableAsset.connect(user1).setDex(await dex.getAddress(), true)
            ).to.be.revertedWithCustomError(stakeableAsset, "OwnableUnauthorizedAccount")
             .withArgs(await user1.getAddress());

            await expect(
                stakeableAsset.connect(user1).pause()
            ).to.be.revertedWithCustomError(stakeableAsset, "OwnableUnauthorizedAccount")
             .withArgs(await user1.getAddress());
        });

        it("Should prevent approve/transfer attack", async function () {
            // This is the key security test for the fix we implemented
            
            // Step 1: User tries to approve DEX before getting locked
            const approveAmount = ethers.parseUnits("1000", 18);
            
            // User should NOT be able to approve initially (approve is now always disabled)
            await expect(
                stakeableAsset.connect(user1).approve(
                    await dex.getAddress(),
                    approveAmount
                )
            ).to.be.revertedWith("Locked: approve disabled");

            // Step 2: User gets locked through deposit
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                ethers.parseUnits("1000", 18),
                30 * DAY
            );

            // Step 3: Now user is locked and should NOT be able to approve DEX
            await expect(
                stakeableAsset.connect(user1).approve(
                    await dex.getAddress(),
                    approveAmount
                )
            ).to.be.revertedWith("Locked: approve disabled");

            // Step 4: Even if DEX tries to use old approval, it should fail
            // because _update() checks if sender is unlocked
            await expect(
                stakeableAsset.connect(dex).transferFrom(
                    await user1.getAddress(),
                    await user2.getAddress(),
                    ethers.parseUnits("100", 18)
                )
            ).to.be.reverted;
        });

        it("Should handle zero balance auto-unlock", async function () {
            // Deposit and then burn all tokens
            const depositAmount = ethers.parseUnits("1000", 18);
            await stakeableAsset.depositAndMint(
                await user1.getAddress(),
                depositAmount,
                30 * DAY
            );

            const tx = await stakeableAsset.burn(
                await user1.getAddress(),
                depositAmount
            );

            // Should auto-unlock when balance is zero
            expect(await stakeableAsset.unlockAt(await user1.getAddress())).to.equal(1);

            // Check that both events were emitted
            await expect(tx)
              .to.emit(stakeableAsset, "StakedTokensBurned")
              .withArgs(await user1.getAddress(), depositAmount);
            
            await expect(tx)
              .to.emit(stakeableAsset, "Unlocked")
              .withArgs(await user1.getAddress());
        });
    });
});
