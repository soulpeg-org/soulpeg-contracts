// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IStUSDCWrapper {
    function getLockInfo(address account) external view returns (uint256 locked, uint256 unlockTime);
}