// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/StakeableAssetImpl.sol";
import "../../contracts/mocks/ERC20Mock.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

contract StakeableAssetFuzzTest is Test {
    StakeableAssetImpl implementation;
    StakeableAssetImpl sa;
    ERC20Mock usdc;
    
    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address dex = makeAddr("dex");
    address attacker = makeAddr("attacker");

    uint256 constant MAX_DEPOSIT = 10_000_000 * 1e18; // 10M USDC
    uint256 constant INITIAL_BALANCE = 100_000_000 * 1e18; // 100M USDC
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy mock USDC
        usdc = new ERC20Mock("Mock USDC", "USDC", 18);
        
        // Deploy implementation
        implementation = new StakeableAssetImpl();
        
        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(
            StakeableAssetImpl.initialize.selector,
            address(usdc),
            "Stakeable USDC",
            "sUSDC"
        );
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(implementation),
            owner,
            initData
        );
        
        sa = StakeableAssetImpl(address(proxy));
        
        // Setup roles
        sa.setOperator(operator, true);
        sa.setDex(dex, true);
        
        // Mint USDC to various accounts
        usdc.mint(owner, INITIAL_BALANCE);
        usdc.mint(user1, INITIAL_BALANCE);
        usdc.mint(user2, INITIAL_BALANCE);
        usdc.mint(operator, INITIAL_BALANCE);
        
        // Approve max for all users
        usdc.approve(address(sa), type(uint256).max);
        
        vm.stopPrank();
        
        vm.prank(user1);
        usdc.approve(address(sa), type(uint256).max);
        
        vm.prank(user2);
        usdc.approve(address(sa), type(uint256).max);
    }

    // ============ Core Invariants ============

    function invariant_totalSupply_matches_totalUSDCDeposited() public view {
        // Total supply should always equal totalUSDCDeposited
        // This ensures no tokens are created out of thin air
        assertEq(
            sa.totalSupply(),
            sa.totalUSDCDeposited(),
            "Total supply must equal total USDC deposited"
        );
    }

    function invariant_usdc_balance_covers_deposits() public view {
        // Contract USDC balance + swept amount should >= totalUSDCDeposited
        uint256 contractBalance = usdc.balanceOf(address(sa));
        uint256 totalDeposited = sa.totalUSDCDeposited();
        
        assertTrue(
            contractBalance >= totalDeposited || totalDeposited == 0,
            "USDC balance must cover all deposits"
        );
    }

    function invariant_user_balances_sum_to_totalSupply() public view {
        // Sum of all user balances should equal total supply
        uint256 sum = sa.balanceOf(owner) + 
                     sa.balanceOf(user1) + 
                     sa.balanceOf(user2) + 
                     sa.balanceOf(operator);
        
        assertLe(sum, sa.totalSupply(), "User balances cannot exceed total supply");
    }

    // ============ Fuzz Tests for depositAndMint ============

    function testFuzz_depositAndMint_valid_amounts(
        uint256 amount,
        uint40 lockPeriod
    ) public {
        // Bound inputs to valid ranges
        amount = bound(amount, 1, sa.DAILY_DEPOSIT_LIMIT());
        lockPeriod = uint40(bound(uint256(lockPeriod), uint256(sa.MIN_LOCK_PERIOD()), uint256(sa.MAX_LOCK_PERIOD())));
        
        vm.startPrank(operator);
        
        uint256 balanceBefore = sa.balanceOf(user1);
        uint256 totalDepositedBefore = sa.totalUSDCDeposited();
        
        sa.depositAndMint(user1, amount, lockPeriod);
        
        assertEq(sa.balanceOf(user1), balanceBefore + amount);
        assertEq(sa.totalUSDCDeposited(), totalDepositedBefore + amount);
        assertEq(sa.totalStaked(user1), balanceBefore + amount);
        
        vm.stopPrank();
    }

    function testFuzz_depositAndMint_reverts_invalid_inputs(
        address user,
        uint256 amount,
        uint40 lockPeriod
    ) public {
        vm.startPrank(operator);
        
        // Test zero address
        if (user == address(0)) {
            vm.expectRevert(bytes("user=0"));
            sa.depositAndMint(user, 1000, 365 days);
        }
        
        // Test zero amount
        if (amount == 0) {
            vm.expectRevert(bytes("amt=0"));
            sa.depositAndMint(user1, 0, 365 days);
        }
        
        // Test invalid lock period
        if (lockPeriod < sa.MIN_LOCK_PERIOD() || lockPeriod > sa.MAX_LOCK_PERIOD()) {
            vm.expectRevert(bytes("lock"));
            sa.depositAndMint(user1, 1000, lockPeriod);
        }
        
        vm.stopPrank();
    }

    // ============ Fuzz Tests for earlyRedeem ============

    function testFuzz_earlyRedeem_partial_amounts(uint256 depositAmount, uint256 redeemAmount) public {
        depositAmount = bound(depositAmount, 1000, sa.DAILY_DEPOSIT_LIMIT());
        redeemAmount = bound(redeemAmount, 1, depositAmount);
        
        // Setup: deposit first
        vm.prank(operator);
        sa.depositAndMint(user1, depositAmount, 365 days);
        
        // Fund contract with USDC for redemption
        vm.prank(owner);
        usdc.transfer(address(sa), depositAmount);
        
        // Test redemption
        vm.prank(operator);
        sa.earlyRedeem(user1, redeemAmount);
        
        assertEq(sa.balanceOf(user1), depositAmount - redeemAmount);
        assertEq(sa.totalStaked(user1), depositAmount - redeemAmount);
    }

    function testFuzz_earlyRedeem_fails_insufficient_balance(
        uint256 depositAmount,
        uint256 redeemAmount
    ) public {
        depositAmount = bound(depositAmount, 1000, sa.DAILY_DEPOSIT_LIMIT());
        
        // Setup: deposit first
        vm.prank(operator);
        sa.depositAndMint(user1, depositAmount, 365 days);
        
        // Fund contract
        vm.prank(owner);
        usdc.transfer(address(sa), depositAmount);
        
        // Try to redeem more than balance
        if (redeemAmount > depositAmount) {
            vm.prank(operator);
            vm.expectRevert(); // Will fail on burn
            sa.earlyRedeem(user1, redeemAmount);
        }
    }

    // ============ Fuzz Tests for Daily Limits ============

    function testFuzz_daily_deposit_limit(uint256[] memory amounts) public {
        vm.assume(amounts.length > 0 && amounts.length < 100);
        
        uint256 totalDeposited = 0;
        
        vm.startPrank(operator);
        
        for (uint i = 0; i < amounts.length; i++) {
            uint256 amount = bound(amounts[i], 1, sa.DAILY_DEPOSIT_LIMIT());
            
            if (totalDeposited + amount <= sa.DAILY_DEPOSIT_LIMIT()) {
                sa.depositAndMint(user1, amount, 365 days);
                totalDeposited += amount;
            } else {
                vm.expectRevert(bytes("deposit/day"));
                sa.depositAndMint(user1, amount, 365 days);
                break;
            }
        }
        
        vm.stopPrank();
    }

    // ============ Fuzz Tests for Transfer Restrictions ============

    function testFuzz_transfer_restrictions_locked_users(
        uint256 amount,
        address recipient
    ) public {
        vm.assume(recipient != address(0) && recipient != user1);
        amount = bound(amount, 1, sa.DAILY_DEPOSIT_LIMIT());
        
        // Deposit with lock
        vm.prank(operator);
        sa.depositAndMint(user1, amount, 365 days);
        
        // Try to transfer while locked
        vm.prank(user1);
        vm.expectRevert(bytes("locked"));
        sa.transfer(recipient, amount);
    }

    function testFuzz_dex_transfer_from_locked(
        uint256 amount,
        address lockedUser
    ) public {
        vm.assume(lockedUser != address(0) && lockedUser != dex);
        amount = bound(amount, 1, sa.DAILY_DEPOSIT_LIMIT());
        
        // Fund the locked user
        vm.prank(owner);
        usdc.transfer(lockedUser, amount);
        
        // Setup approval first
        vm.prank(lockedUser);
        usdc.approve(address(sa), amount);
        
        // Deposit with lock
        vm.prank(operator);
        sa.depositAndMint(lockedUser, amount, 365 days);
        
        // Locked users cannot approve anyone
        vm.prank(lockedUser);
        vm.expectRevert(bytes("Locked: approve disabled"));
        sa.approve(dex, amount);
    }

    // ============ Fuzz Tests for Reward Distribution ============

    function testFuzz_rewardMint_distribution(
        uint256[] memory stakes,
        uint256 totalReward
    ) public {
        vm.assume(stakes.length > 0 && stakes.length <= 10);
        totalReward = bound(totalReward, 1000, sa.DAILY_MINT_LIMIT());
        
        // Setup: multiple users stake
        vm.startPrank(operator);
        
        uint256 totalStaked = 0;
        address[] memory users = new address[](stakes.length);
        
        for (uint i = 0; i < stakes.length; i++) {
            users[i] = address(uint160(i + 100)); // Generate unique addresses
            uint256 stake = bound(stakes[i], 1000, 1_000_000 * 1e18);
            
            // Fund user
            vm.stopPrank();
            vm.prank(owner);
            usdc.transfer(users[i], stake);
            vm.prank(users[i]);
            usdc.approve(address(sa), stake);
            
            vm.startPrank(operator);
            sa.depositAndMint(users[i], stake, 365 days);
            totalStaked += stake;
        }
        
        // Skip some time
        skip(30 days);
        
        // Distribute rewards proportionally
        for (uint i = 0; i < users.length; i++) {
            uint256 userStake = sa.balanceOf(users[i]);
            uint256 userReward = (totalReward * userStake) / totalStaked;
            
            if (userReward > 0) {
                sa.rewardMint(users[i], userReward, 0);
            }
        }
        
        vm.stopPrank();
        
        // Verify total supply increased by reward amount (allow small rounding error)
        assertApproxEqAbs(sa.totalSupply(), totalStaked + totalReward, users.length);
    }

    // ============ Stateful Fuzz Testing ============
}

// Handler contract for stateful fuzzing
contract StakeableHandler is Test {
        StakeableAssetImpl public sa;
        ERC20Mock public usdc;
        address public operator;
        
        address[] public actors;
        mapping(address => uint256) public deposits;
        
        constructor(StakeableAssetImpl _sa, ERC20Mock _usdc, address _operator) {
            sa = _sa;
            usdc = _usdc;
            operator = _operator;
            
            // Create some actors
            for (uint i = 0; i < 5; i++) {
                actors.push(makeAddr(string(abi.encodePacked("actor", i))));
            }
        }
        
        function deposit(uint256 actorIndex, uint256 amount, uint40 lockPeriod) public {
            actorIndex = actorIndex % actors.length;
            address actor = actors[actorIndex];
            
            amount = bound(amount, 1, sa.DAILY_DEPOSIT_LIMIT() / 10);
            lockPeriod = uint40(bound(uint256(lockPeriod), uint256(sa.MIN_LOCK_PERIOD()), uint256(sa.MAX_LOCK_PERIOD())));
            
            // Fund actor
            vm.prank(address(this));
            usdc.transfer(actor, amount);
            
            vm.prank(actor);
            usdc.approve(address(sa), amount);
            
            vm.prank(operator);
            try sa.depositAndMint(actor, amount, lockPeriod) {
                deposits[actor] += amount;
            } catch {
                // Ignore failures (daily limit, etc)
            }
        }
        
        function redeem(uint256 actorIndex, uint256 amount) public {
            actorIndex = actorIndex % actors.length;
            address actor = actors[actorIndex];
            
            uint256 balance = sa.balanceOf(actor);
            if (balance == 0) return;
            
            amount = bound(amount, 0, balance);
            
            // Fund contract for redemption
            vm.prank(address(this));
            usdc.transfer(address(sa), amount);
            
            vm.prank(operator);
            try sa.earlyRedeem(actor, amount) {
                deposits[actor] -= amount;
            } catch {
                // Ignore failures
            }
        }
        
        function checkInvariants() public view {
            // Total deposits should match
            uint256 totalDeposited = 0;
            for (uint i = 0; i < actors.length; i++) {
                totalDeposited += deposits[actors[i]];
            }
            
            assertLe(totalDeposited, sa.totalUSDCDeposited(), "Tracked deposits exceed contract state");
        }
    }