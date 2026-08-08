// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../strategies/VenusUSDCVault.sol";

contract FeeVaultMock is VenusUSDCVault {
    uint16 public constant FEE_BPS = 1; // 0.01 %

    constructor(IERC20Metadata u, IVToken v) VenusUSDCVault(u, v) {}

    // Override redeemUnderlying с комиссией
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) _spendAllowance(owner, caller, shares);

        uint256 fee = (assets * FEE_BPS) / 10_000;
        require(vToken.redeemUnderlying(assets) == 0, "fail");
        _burn(owner, shares);
        IERC20(asset()).transfer(receiver, assets - fee);
    }
    /* ------------------------------------------------------------------ */
    /* IERC4626 preview overrides to account for the withdrawal fee       */
    /* ------------------------------------------------------------------ */
    function previewWithdraw(uint256 assets)
        public
        view
        override
        returns (uint256 shares)
    {
        // we need to redeem a bit more assets to cover the fee
        uint256 gross = assets + (assets * FEE_BPS) / 10_000;
        shares = super.previewWithdraw(gross);
    }

    function previewRedeem(uint256 shares)
        public
        view
        override
        returns (uint256 assets)
    {
        uint256 net = super.previewRedeem(shares);
        uint256 fee = (net * FEE_BPS) / 10_000;
        assets = net - fee;
    }
}