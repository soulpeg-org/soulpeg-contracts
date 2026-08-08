// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IStUSDCWrapper.sol";

contract MockWrapper is IStUSDCWrapper {
    mapping(address => uint256) public lockedAmounts;
    mapping(address => uint256) public unlockTimes;
    
    function setLockInfo(address account, uint256 amount, uint256 unlockTime) external {
        lockedAmounts[account] = amount;
        unlockTimes[account] = unlockTime;
    }
    
    function getLockInfo(address account) external view override returns (uint256 locked, uint256 unlockTime) {
        if (block.timestamp >= unlockTimes[account]) {
            return (0, 0);
        }
        return (lockedAmounts[account], unlockTimes[account]);
    }
}