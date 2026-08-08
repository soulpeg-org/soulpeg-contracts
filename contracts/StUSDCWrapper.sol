// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SPUSD.sol";

/**
 * @title StUSDCWrapper V2
 * @notice One-way wrapper contract for converting sUSDC to SPUSD with lock support
 * @dev Handles wrap operations and locked tokens for investors
 */
contract StUSDCWrapper is Ownable, AccessControl, ReentrancyGuard {
    // Version identifier to change bytecode
    string public constant VERSION = "2.0.0";
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    IERC20 public immutable sUSDC;
    SPUSD public immutable spusd;
    
    // Locked token tracking
    struct LockInfo {
        uint256 amount;
        uint256 unlockTime;
    }
    
    mapping(address => LockInfo) public lockedBalances;
    
    // Events
    event Wrapped(address indexed user, uint256 amount);
    event LockedTokensMinted(address indexed to, uint256 amount, uint256 unlockTime);
    
    constructor(address _sUSDC, address _spusd) Ownable(msg.sender) {
        require(_sUSDC != address(0), "Wrapper: Invalid sUSDC");
        require(_spusd != address(0), "Wrapper: Invalid SPUSD");
        
        sUSDC = IERC20(_sUSDC);
        spusd = SPUSD(_spusd);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @notice Wrap sUSDC to get SPUSD
     * @param amount Amount of sUSDC to wrap
     */
    function wrap(uint256 amount) external nonReentrant {
        require(amount > 0, "Wrapper: Zero amount");
        
        // Transfer sUSDC from user to this contract
        require(
            sUSDC.transferFrom(msg.sender, address(this), amount),
            "Wrapper: Transfer failed"
        );
        
        // Mint equivalent SPUSD to user
        spusd.mint(msg.sender, amount);
        
        emit Wrapped(msg.sender, amount);
    }
    
    /**
     * @notice Mint locked SPUSD tokens for investors
     * @dev Only owner can call this
     * @param to Recipient address
     * @param amount Amount to mint
     * @param unlockTime Timestamp when tokens unlock
     */
    function wrapAndLock(
        address to,
        uint256 amount,
        uint256 unlockTime
    ) external nonReentrant {
        require(
            owner() == msg.sender || hasRole(OPERATOR_ROLE, msg.sender),
            "Wrapper: Not authorized"
        );
        require(to != address(0), "Wrapper: Invalid recipient");
        require(amount > 0, "Wrapper: Zero amount");
        require(unlockTime > block.timestamp, "Wrapper: Invalid unlock time");
        
        // Transfer sUSDC from owner to this contract
        require(
            sUSDC.transferFrom(msg.sender, address(this), amount),
            "Wrapper: Transfer failed"
        );
        
        // Update locked balance - use max to prevent reducing existing lock
        if (unlockTime > lockedBalances[to].unlockTime) {
            lockedBalances[to].unlockTime = unlockTime;
        }
        lockedBalances[to].amount = lockedBalances[to].amount + amount;
        
        // Mint SPUSD to recipient
        spusd.mint(to, amount);
        
        emit LockedTokensMinted(to, amount, unlockTime);
    }
    
    /**
     * @notice Grant or revoke OPERATOR_ROLE
     * @dev Only owner can call this
     * @param operator Address to grant/revoke role
     * @param granted True to grant, false to revoke
     */
    function setOperator(address operator, bool granted) external onlyOwner {
        if (granted) {
            grantRole(OPERATOR_ROLE, operator);
        } else {
            revokeRole(OPERATOR_ROLE, operator);
        }
    }
    
    /**
     * @notice Check if address has locked tokens
     * @param account Address to check
     * @return locked Amount of locked tokens
     * @return unlockTime When tokens unlock
     */
    function getLockInfo(address account) external view returns (uint256 locked, uint256 unlockTime) {
        LockInfo memory lock = lockedBalances[account];
        if (block.timestamp >= lock.unlockTime) {
            return (0, 0);
        }
        return (lock.amount, lock.unlockTime);
    }
}