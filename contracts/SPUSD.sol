// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IStUSDCWrapper.sol";

/**
 * @title SPUSD - SoulPeg USD v2
 * @notice Tradeable wrapper token for soul-bound sUSDC with lock support
 * @dev Only authorized wrapper contract can mint/burn
 */
contract SPUSD is ERC20, AccessControl {
    string public constant VERSION = "2.0.0";
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    // 1 billion max supply cap for safety
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18;
    
    // Wrapper contract address (set once in constructor)
    address public immutable wrapper;
    
    constructor(address _wrapper) ERC20("SoulPeg USD", "SPUSD") {
        require(_wrapper != address(0), "SPUSD: Invalid wrapper");
        wrapper = _wrapper;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @notice Mint new SPUSD tokens
     * @dev Only callable by MINTER_ROLE (wrapper contract)
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "SPUSD: Max supply exceeded");
        _mint(to, amount);
    }
    
    /**
     * @notice Burn SPUSD tokens from an address
     * @dev Only callable by BURNER_ROLE (wrapper contract)
     * @param from Address to burn tokens from
     * @param amount Amount to burn
     */
    function burnFrom(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }
    
    /**
     * @notice Override transfer to check for locks
     * @dev Checks if sender has locked tokens in wrapper
     */
    function _update(address from, address to, uint256 amount) internal override {
        // Skip check for minting/burning
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }
        
        // Check if sender has locked tokens
        (uint256 locked, uint256 unlockTime) = IStUSDCWrapper(wrapper).getLockInfo(from);
        if (locked > 0 && block.timestamp < unlockTime) {
            // Calculate available balance (total - locked)
            uint256 balance = balanceOf(from);
            require(balance - amount >= locked, "SPUSD: Tokens locked");
        }
        
        super._update(from, to, amount);
    }
}