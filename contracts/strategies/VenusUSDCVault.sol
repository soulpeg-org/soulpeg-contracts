// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VenusUSDCVault
 * @notice Thin ERC‑4626 adapter around the Venus vUSDC market.
 *         Accepts native USDC (18 dec on BSC) and mints “shares” representing
 *         a proportional claim on the underlying vUSDC balance.
 *
 *         – deposit(): pull USDC → supply to Venus via vUSDC.mint()
 *         – withdraw(): redeemUnderlying() from Venus and transfer USDC
 *
 * Security:
 *  • Re‑entrancy is guarded by ERC4626 (non‑reentrant hooks).
 *  • All external Venus calls revert on non‑zero status codes.
 *  • An immutable underlying token guarantees the adapter cannot be mis‑pointed.
 */

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/* ---------- Minimal vToken interface (Venus / Compound style) ---------- */
interface IVToken is IERC20 {
    function underlying() external view returns (address);
    /* Supply underlying, receive vTokens; returns 0 = success */
    function mint(uint256) external returns (uint256);
    /* Redeem an *amount* of underlying; returns 0 = success */
    function redeemUnderlying(uint256) external returns (uint256);
    /* Redeem all vTokens held */
    function redeem(uint256) external returns (uint256);
    /* 1 vToken → ? underlying (scaled 1e18) */
    function exchangeRateCurrent() external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    /* Underlying balance incl. accrued interest */
    function balanceOfUnderlying(address) external returns (uint256);
}

contract VenusUSDCVault is ERC4626 {
    using SafeERC20 for IERC20;

    IVToken public immutable vToken;

    /* --------------------------------------------------------------------- */
    /* Constructor                                                           */
    /* --------------------------------------------------------------------- */
    constructor(IERC20Metadata _usdc, IVToken _vToken)
        ERC20("Venus USDC Vault", "vUSDC-Vault")
        ERC4626(_usdc)
    {
        require(_vToken.underlying() == address(_usdc), "asset mismatch");
        vToken = _vToken;

        // Approve max once
        SafeERC20.forceApprove(IERC20(address(_usdc)), address(_vToken), type(uint256).max);
    }

    /* --------------------------------------------------------------------- */
    /* ERC‑4626 overrides                                                    */
    /* --------------------------------------------------------------------- */

    /// @dev Total USDC managed by this vault (reserve held at Venus)
    function totalAssets() public view override returns (uint256) {
        // Используем exchangeRateStored вместо balanceOfUnderlying для view-функции
        uint256 vTokenBalance = vToken.balanceOf(address(this));
        uint256 exchangeRate = vToken.exchangeRateStored();
        return (vTokenBalance * exchangeRate) / 1e18;
    }

    /**
     * @dev Convert given amount of USDC to shares using latest exchange rate.
     *      Venus’ exchangeRate is scaled by 1e18 ⇒ shares = assets * 1e18 / rate.
     */
    function convertToShares(uint256 assets)
        public
        view
        override
        returns (uint256 shares)
    {
        uint256 rate = vToken.exchangeRateStored(); // 1e18 scale
        shares = (assets * 1e18) / rate;
    }

    function convertToAssets(uint256 shares)
        public
        view
        override
        returns (uint256 assets)
    {
        uint256 rate = vToken.exchangeRateStored();
        assets = (shares * rate) / 1e18;
    }

    /* --------------------------------------------------------------------- */
    /* Internal hooks: deposit / withdraw                                    */
    /* --------------------------------------------------------------------- */

    /**
     * @dev Pull USDC from caller, supply to Venus.
     *      Rely on ERC4626 to mint shares & emit Deposit event.
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        IERC20(asset()).safeTransferFrom(caller, address(this), assets);
        require(vToken.mint(assets) == 0, "vToken.mint failed");
        _mint(receiver, shares);
    }

    /**
     * @dev Redeem underlying from Venus and transfer to `receiver`.
     *      ERC4626 burns shares and emits Withdraw.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) _spendAllowance(owner, caller, shares);

        require(
            vToken.redeemUnderlying(assets) == 0,
            "vToken.redeemUnderlying fail"
        );

        _burn(owner, shares);
        IERC20(asset()).safeTransfer(receiver, assets);
    }
}
