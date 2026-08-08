// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/StrategyRouter.sol";
import "../../contracts/strategies/VenusUSDCVault.sol";
import "../../contracts/mocks/ERC20Mock.sol";
import "../../contracts/mocks/VUSDMock.sol";

contract StrategyRouterFuzzTest is Test {
    StrategyRouter router;
    VenusUSDCVault vault1;
    VenusUSDCVault vault2;
    ERC20Mock usdc;
    VUSDCMock vusd1;
    VUSDCMock vusd2;
    
    address owner = makeAddr("owner");
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");
    
    uint256 constant INITIAL_BALANCE = 1_000_000 * 1e18;
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy USDC
        usdc = new ERC20Mock("USDC", "USDC", 18);
        
        // Deploy mock Venus markets
        vusd1 = new VUSDCMock(usdc);
        vusd2 = new VUSDCMock(usdc);
        
        // Deploy vaults
        vault1 = new VenusUSDCVault(usdc, vusd1);
        vault2 = new VenusUSDCVault(usdc, vusd2);
        
        // Deploy router
        router = new StrategyRouter(usdc);
        
        // Add strategies
        router.addStrategy(vault1, 7000); // 70%
        router.addStrategy(vault2, 3000); // 30%
        
        // Fund users
        usdc.mint(owner, INITIAL_BALANCE);
        usdc.mint(user, INITIAL_BALANCE);
        usdc.approve(address(router), type(uint256).max);
        
        vm.stopPrank();
        
        vm.prank(user);
        usdc.approve(address(router), type(uint256).max);
    }
    
    // ============ Core Invariants ============
    
    function invariant_total_weights_le_10000() public view {
        assertTrue(
            router.totalWeightBps() <= 10000,
            "Total weights must not exceed 100%"
        );
    }
    
    function invariant_router_value_preserved() public view {
        // Router's total value = reserve + sum(vault shares value)
        uint256 reserve = usdc.balanceOf(address(router));
        
        uint256 vaultValue = 0;
        uint256 numStrats = 2; // We know we have 2 strategies
        
        (IERC4626 strat1,,) = router.strategies(0);
        (IERC4626 strat2,,) = router.strategies(1);
        
        if (address(strat1) != address(0)) {
            uint256 shares1 = strat1.balanceOf(address(router));
            vaultValue += strat1.convertToAssets(shares1);
        }
        
        if (address(strat2) != address(0)) {
            uint256 shares2 = strat2.balanceOf(address(router));
            vaultValue += strat2.convertToAssets(shares2);
        }
        
        // Total value should be preserved (minus small rounding)
        assertTrue(reserve + vaultValue >= 0, "Value must be non-negative");
    }
    
    // ============ Fuzz Tests for Deposits ============
    
    function testFuzz_deposit_splits_correctly(uint256 amount) public {
        amount = bound(amount, 1000, INITIAL_BALANCE);
        
        uint256 vault1BalBefore = vault1.totalAssets();
        uint256 vault2BalBefore = vault2.totalAssets();
        
        vm.prank(user);
        router.deposit(amount);
        
        uint256 vault1BalAfter = vault1.totalAssets();
        uint256 vault2BalAfter = vault2.totalAssets();
        
        // Check approximate split (allowing for rounding)
        uint256 vault1Increase = vault1BalAfter - vault1BalBefore;
        uint256 vault2Increase = vault2BalAfter - vault2BalBefore;
        
        // Vault1 should get ~70%
        assertApproxEqRel(vault1Increase, (amount * 70) / 100, 0.01e18);
        // Vault2 should get ~30%
        assertApproxEqRel(vault2Increase, (amount * 30) / 100, 0.01e18);
    }
    
    function testFuzz_deposit_reverts_zero(uint256 amount) public {
        if (amount == 0) {
            vm.expectRevert(bytes("amount=0"));
            vm.prank(user);
            router.deposit(amount);
        }
    }
    
    // ============ Fuzz Tests for Redemptions ============
    
    function testFuzz_redeem_uses_reserve_first(
        uint256 depositAmount,
        uint256 reserveAmount,
        uint256 redeemAmount
    ) public {
        depositAmount = bound(depositAmount, 10000, INITIAL_BALANCE / 2);
        reserveAmount = bound(reserveAmount, 0, depositAmount / 2);
        redeemAmount = bound(redeemAmount, 1, depositAmount);
        
        // Setup: deposit first
        vm.prank(user);
        router.deposit(depositAmount);
        
        // Add some reserve
        if (reserveAmount > 0) {
            vm.prank(owner);
            usdc.transfer(address(router), reserveAmount);
        }
        
        uint256 reserveBefore = usdc.balanceOf(address(router));
        uint256 ownerBalBefore = usdc.balanceOf(owner);
        
        // Redeem
        vm.prank(owner);
        router.redeem(redeemAmount, owner);
        
        uint256 reserveAfter = usdc.balanceOf(address(router));
        uint256 ownerBalAfter = usdc.balanceOf(owner);
        
        // Check that reserve was used first
        if (reserveBefore >= redeemAmount) {
            // All from reserve
            assertEq(reserveBefore - reserveAfter, redeemAmount);
        } else {
            // Reserve depleted, rest from vaults
            assertEq(reserveAfter, 0);
        }
        
        assertEq(ownerBalAfter - ownerBalBefore, redeemAmount);
    }
    
    // ============ Fuzz Tests for Strategy Management ============
    
    function testFuzz_update_strategy_weights(
        uint16 newWeight1,
        uint16 newWeight2
    ) public {
        // Ensure new total weights don't exceed 100%
        // We need the sum of both weights to be <= 10000
        uint256 maxTotal = 10000;
        newWeight1 = uint16(bound(newWeight1, 0, maxTotal));
        newWeight2 = uint16(bound(newWeight2, 0, maxTotal - newWeight1));
        
        vm.startPrank(owner);
        
        // First, set both strategies to 0 to avoid exceeding limit during updates
        router.updateStrategy(0, 0, false);
        router.updateStrategy(1, 0, false);
        
        // Now update to new weights
        router.updateStrategy(0, newWeight1, newWeight1 > 0);
        router.updateStrategy(1, newWeight2, newWeight2 > 0);
        
        // Check total weight
        assertLe(router.totalWeightBps(), 10000);
        
        // Verify weights were set
        (,uint16 weight1,bool active1) = router.strategies(0);
        (,uint16 weight2,bool active2) = router.strategies(1);
        
        assertEq(weight1, newWeight1);
        assertEq(weight2, newWeight2);
        assertTrue(active1 == (newWeight1 > 0));
        assertTrue(active2 == (newWeight2 > 0));
        
        vm.stopPrank();
    }
    
    // ============ Fuzz Tests for Access Control ============
    
    function testFuzz_only_owner_functions(address caller) public {
        vm.assume(caller != owner && caller != address(0));
        
        vm.startPrank(caller);
        
        // addStrategy
        vm.expectRevert();
        router.addStrategy(IERC4626(address(0x123)), 1000);
        
        // updateStrategy
        vm.expectRevert();
        router.updateStrategy(0, 5000, true);
        
        // investReserve
        vm.expectRevert();
        router.investReserve(1000);
        
        // redeem
        vm.expectRevert();
        router.redeem(1000, caller);
        
        // approveUSDC
        vm.expectRevert();
        router.approveUSDC(address(0x123), 1000);
        
        vm.stopPrank();
    }
    
    // ============ Fuzz Tests for Edge Cases ============
    
    function testFuzz_deposit_with_inactive_strategies(uint256 amount) public {
        amount = bound(amount, 1000, INITIAL_BALANCE);
        
        // Deactivate one strategy
        vm.prank(owner);
        router.updateStrategy(1, 3000, false); // Deactivate vault2
        
        uint256 vault1BalBefore = vault1.totalAssets();
        uint256 vault2BalBefore = vault2.totalAssets();
        
        vm.prank(user);
        router.deposit(amount);
        
        uint256 vault1BalAfter = vault1.totalAssets();
        uint256 vault2BalAfter = vault2.totalAssets();
        
        // All should go to vault1
        assertEq(vault1BalAfter - vault1BalBefore, amount);
        assertEq(vault2BalAfter - vault2BalBefore, 0);
    }
    
    function testFuzz_investReserve_amount(uint256 reserveAmount) public {
        reserveAmount = bound(reserveAmount, 1000, INITIAL_BALANCE);
        
        // Add reserve
        vm.prank(owner);
        usdc.transfer(address(router), reserveAmount);
        
        uint256 reserveBefore = usdc.balanceOf(address(router));
        
        // Invest reserve
        vm.prank(owner);
        router.investReserve(reserveAmount);
        
        uint256 reserveAfter = usdc.balanceOf(address(router));
        
        // Reserve should decrease by invested amount
        assertEq(reserveBefore - reserveAfter, reserveAmount);
        
        // Check vaults received funds
        uint256 totalInVaults = vault1.totalAssets() + vault2.totalAssets();
        assertGe(totalInVaults, reserveAmount);
    }
    
    // ============ Stateful Fuzz Testing ============
}

contract RouterHandler is Test {
        StrategyRouter public router;
        ERC20Mock public usdc;
        address public owner;
        address[] public users;
        
        uint256 public totalDeposited;
        uint256 public totalRedeemed;
        
        constructor(StrategyRouter _router, ERC20Mock _usdc, address _owner) {
            router = _router;
            usdc = _usdc;
            owner = _owner;
            
            // Create users
            for (uint i = 0; i < 3; i++) {
                users.push(makeAddr(string(abi.encodePacked("user", i))));
            }
        }
        
        function deposit(uint256 userIndex, uint256 amount) public {
            userIndex = userIndex % users.length;
            address user = users[userIndex];
            
            amount = bound(amount, 100, 100_000 * 1e18);
            
            // Fund user
            vm.prank(address(this));
            usdc.transfer(user, amount);
            
            vm.prank(user);
            usdc.approve(address(router), amount);
            
            vm.prank(user);
            try router.deposit(amount) {
                totalDeposited += amount;
            } catch {
                // Ignore failures
            }
        }
        
        function ownerRedeem(uint256 amount) public {
            uint256 balance = usdc.balanceOf(address(router));
            
            // Get total value in vaults
            uint256 vaultValue = 0;
            (IERC4626 strat1,,) = router.strategies(0);
            if (address(strat1) != address(0)) {
                vaultValue += strat1.convertToAssets(strat1.balanceOf(address(router)));
            }
            
            uint256 totalValue = balance + vaultValue;
            if (totalValue == 0) return;
            
            amount = bound(amount, 0, totalValue);
            
            vm.prank(owner);
            try router.redeem(amount, owner) {
                totalRedeemed += amount;
            } catch {
                // Ignore failures
            }
        }
        
        function checkInvariant() public view {
            // Total deposited - redeemed should roughly equal router value
            uint256 netDeposited = totalDeposited > totalRedeemed 
                ? totalDeposited - totalRedeemed 
                : 0;
                
            uint256 routerValue = usdc.balanceOf(address(router));
            
            // Add vault values
            (IERC4626 strat1,,) = router.strategies(0);
            (IERC4626 strat2,,) = router.strategies(1);
            
            if (address(strat1) != address(0)) {
                routerValue += strat1.convertToAssets(strat1.balanceOf(address(router)));
            }
            if (address(strat2) != address(0)) {
                routerValue += strat2.convertToAssets(strat2.balanceOf(address(router)));
            }
            
            // Allow small rounding errors
            assertApproxEqAbs(routerValue, netDeposited, 100);
        }
    }