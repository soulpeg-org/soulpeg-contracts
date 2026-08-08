// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../strategies/VenusUSDCVault.sol";

contract VUSDCMock is ERC20("vUSDC-Mock", "vUSDC"), IVToken {
    IERC20 public immutable usdc;
    uint256 private _rate = 1e18;               // scaled 1e18  (1 v = 1 USDC)

    constructor(IERC20 _usdc) {
        usdc = _usdc;
    }

    /* ───────── Venus-like API ───────── */
    function underlying() external view returns (address) { return address(usdc); }
    function exchangeRateStored() external view returns (uint256) { return _rate; }
    function exchangeRateCurrent() external view returns (uint256) { return _rate; }

    function setExchangeRate(uint256 newRate) external { _rate = newRate; }

    function balanceOfUnderlying(address acc) external view returns (uint256) {
        return (balanceOf(acc) * _rate) / 1e18;
    }

    function mint(uint256 amt) external returns (uint256) {
        usdc.transferFrom(msg.sender, address(this), amt);
        uint256 shares = (amt * 1e18) / _rate;
        _mint(msg.sender, shares);
        return 0;                               // 0 = success in Venus
    }

    function redeemUnderlying(uint256 amt) external returns (uint256) {
        uint256 shares = (amt * 1e18) / _rate;
        _burn(msg.sender, shares);
        usdc.transfer(msg.sender, amt);
        return 0;
    }

    function redeem(uint256 shares) external returns (uint256) {
        uint256 amt = (shares * _rate) / 1e18;
        _burn(msg.sender, shares);
        usdc.transfer(msg.sender, amt);
        return 0;
    }
}