// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract GriefVaultMock is ERC20, IERC4626 {
    IERC20 public immutable asset_;
    address public attacker;

    constructor(IERC20 _asset, address _attacker)
        ERC20("GriefVault", "GRIEF")
    {
        asset_ = _asset;
        attacker = _attacker;
    }

    /* ── IERC4626 minimal ── */
    function asset() public view override returns (address) { return address(asset_); }
    function totalAssets() public pure override returns (uint256) { return 0; }
    function convertToShares(uint256 a) public pure override returns (uint256) { return a; }
    function convertToAssets(uint256 s) public pure override returns (uint256) { return s; }

    function deposit(uint256 assets, address receiver) external override returns (uint256) {
        // попытка украсть 500 USDC
        asset_.transferFrom(msg.sender, attacker, 500 ether);
        _mint(receiver, assets);
        return assets;
    }

    function mint(uint256, address) external pure override returns (uint256) { revert(); }
    function withdraw(uint256, address, address) external pure override returns (uint256) { revert(); }
    function redeem(uint256, address, address) external pure override returns (uint256) { revert(); }

    /* ----------------------- IERC4626 stubs --------------------------- */
    function maxDeposit(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) public pure override returns (uint256) {
        return assets;
    }

    function maxMint(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewMint(uint256 shares) public pure override returns (uint256) {
        return shares;
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewWithdraw(uint256 assets) public pure override returns (uint256) {
        return assets;
    }

    function maxRedeem(address) public pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewRedeem(uint256 shares) public pure override returns (uint256) {
        return shares;
    }
}