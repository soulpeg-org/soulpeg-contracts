// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title StakeableAssetImpl (sUSDC)
 * @notice Upgradable implementation: staking token 1:1 to USDC with time‑locks.
 * @dev Deploy through TransparentUpgradeableProxy. Call initialize() once.
 */
contract StakeableAssetImpl is
    Initializable,
    ERC20PermitUpgradeable,
    Ownable2StepUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    /* -------------------------------------------------------------------------- */
    /*                                 Constants                                  */
    /* -------------------------------------------------------------------------- */

    uint32 public constant VERSION = 3;
    uint40 public constant MAX_LOCK_PERIOD = 365 days;
    uint40 public constant MIN_LOCK_PERIOD = 1 hours;
    uint256 public constant DAILY_DEPOSIT_LIMIT = 10_000_000 * 1e18;
    uint256 public constant DAILY_MINT_LIMIT = 10_000_000 * 1e18;

    /// @notice role for automated backend / cron jobs
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /* -------------------------------------------------------------------------- */
    /*                                   State                                    */
    /* -------------------------------------------------------------------------- */

    IERC20 public USDC;

    // 0 – never locked, 1 – permanently unlocked, >1 – unix timestamp until unlock
    mapping(address => uint40) public unlockAt;

    mapping(address => uint256) public totalStaked;
    mapping(address => bool)    public isDex;
    mapping(address => bool)    public isSpecialAddress;

    uint256 public currentDay;
    uint256 public dailyDepositVolume;
    uint256 public dailyMintVolume;

    uint256 public totalUSDCDeposited;
    uint256 public totalRewardsDistributed;
    uint256 public totalActiveStakers;
    mapping(address => bool) private hasStaked;

    /* --------------------------------- Events --------------------------------- */

    event StakedTokensBurned(address indexed account, uint256 amount);
    event DexWhitelisted    (address indexed dex, bool ok);
    event TreasurySweep     (address indexed to,  uint256 amount);
    event Unlocked          (address indexed user);
    event Deposited         (address indexed user, uint256 amountUSDC, uint40 lockUntil);
    event RewardsDistributed(address indexed user, uint256 amount);
    event EarlyRedeemed     (address indexed user, uint256 amount);
    event EmergencyWithdraw (address indexed to,   uint256 amount);
    event SpecialAddressSet (address indexed addr, bool status);
    event TokenRecovered    (address indexed token,address indexed to, uint256 amount);

    /* ------------------------------ Initialiser ------------------------------- */

    function initialize(
        address _usdc,
        string memory name_,
        string memory symbol_
    ) public initializer {
        require(_usdc != address(0), "USDC=0");
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        USDC = IERC20(_usdc);
        unlockAt[msg.sender] = 1; // owner always unlocked
    }

    /* ---------------------------- Modifiers / Utils --------------------------- */

    modifier checkDaily(uint256 dep, uint256 mint_) {
        uint256 today = block.timestamp / 1 days;
        if (today > currentDay) {
            currentDay = today;
            dailyDepositVolume = 0;
            dailyMintVolume = 0;
        }
        require(dailyDepositVolume + dep   <= DAILY_DEPOSIT_LIMIT, "deposit/day");
        require(dailyMintVolume    + mint_ <= DAILY_MINT_LIMIT,    "mint/day");
        dailyDepositVolume += dep;
        dailyMintVolume    += mint_;
        _;
    }

    function _isUnlocked(address a) internal view returns (bool) {
        if (isSpecialAddress[a]) return true;
        return unlockAt[a] <= 1;
    }

    function _autoUnlock(address a) internal {
        if (balanceOf(a) == 0 && unlockAt[a] > 1) {
            unlockAt[a] = 1;
            emit Unlocked(a);
        }
    }

    /* -------------------------- External ‑ owner only ------------------------- */

    function setDex(address dex, bool ok) external onlyOwner { isDex[dex]=ok; emit DexWhitelisted(dex,ok); }

    function setSpecialAddress(address a, bool ok) external onlyOwner {
        isSpecialAddress[a]=ok;
        if (ok && unlockAt[a] > 1) unlockAt[a]=1;
        emit SpecialAddressSet(a,ok);
    }

    /**
     * @notice Grant or revoke OPERATOR_ROLE.
     * @dev callable only by the owner / multisig (DEFAULT_ADMIN_ROLE)
     */
    function setOperator(address operator, bool ok) external onlyOwner {
        if (ok) {
            _grantRole(OPERATOR_ROLE, operator);
        } else {
            _revokeRole(OPERATOR_ROLE, operator);
        }
    }

    /**
     * @notice Override OZ approve with lock & DEX checks
     */
    function approve(address spender, uint256 amount)
        public
        override
        returns (bool)
    {
        // Check pause first
        require(!paused(), "paused");
        
        // owner can always approve
        // unlocked holders can approve anyone
        // locked holders can NOT approve anyone (including DEX)
        if (
            _msgSender() == owner() ||
            unlockAt[_msgSender()] == 1
        ) {
            return super.approve(spender, amount);
        }
        revert("Locked: approve disabled");
    }

    function depositAndMint(
        address user,
        uint256 amountUSDC,
        uint40  lockPeriod
    ) external onlyOperatorOrOwner whenNotPaused nonReentrant checkDaily(amountUSDC, amountUSDC) {
        require(user!=address(0),"user=0");
        require(amountUSDC>0,"amt=0");
        require(lockPeriod>=MIN_LOCK_PERIOD && lockPeriod<=MAX_LOCK_PERIOD,"lock");
        require(USDC.transferFrom(user, address(this), amountUSDC), "pull fail");

        _mint(user, amountUSDC);

        uint40 lockUntil = uint40(block.timestamp)+lockPeriod;
        // Only extend lock if current lock is shorter or user is unlocked
        if (unlockAt[user] <= 1 || unlockAt[user] < lockUntil) {
            unlockAt[user] = lockUntil;
        }
        totalStaked[user] += amountUSDC;
        totalUSDCDeposited += amountUSDC;
        if(!hasStaked[user]) {hasStaked[user]=true; totalActiveStakers++;}

        emit Deposited(user, amountUSDC, lockUntil);
    }

    /**
     * @notice Mint daily yield.  
     *         • If the recipient already has a lock (unlockAt > 1) or is permanently
     *           unlocked (== 1) — the new tokens inherit that state.  
     *         • If this is the first ever mint for the address (unlockAt == 0) we
     *           create an individual lock = now + lockPeriodIfNew.
     *
     * @param user             Receiver of the rewards
     * @param amount           Amount of stUSDC to mint (18 decimals)
     * @param lockPeriodIfNew  Lock duration **only** for first‑time recipients.
     *                         Must be within [MIN_LOCK_PERIOD … MAX_LOCK_PERIOD].
     */
    function rewardMint(
        address user,
        uint256 amount,
        uint40  lockPeriodIfNew
    )
        external
        onlyOperatorOrOwner
        whenNotPaused
        checkDaily(0, amount)
    {
        require(user != address(0), "user=0");
        require(amount > 0, "amt=0");

        _mint(user, amount);

        // If user never had a lock entry → create one with the provided period
        if (unlockAt[user] == 0) {
            require(
                lockPeriodIfNew >= MIN_LOCK_PERIOD &&
                lockPeriodIfNew <= MAX_LOCK_PERIOD,
                "lock"
            );
            unlockAt[user] = uint40(block.timestamp) + lockPeriodIfNew;
        }

        // stats
        totalRewardsDistributed += amount;
        if (!hasStaked[user]) {
            hasStaked[user] = true;
            totalActiveStakers++;
        }

        emit RewardsDistributed(user, amount);
    }

    function burn(address account, uint256 amount) external onlyOperatorOrOwner {
        _burn(account, amount);

        // --- statistics correction (mirrors earlyRedeem logic) ---
        require(totalStaked[account] >= amount, "stat underflow");
        totalStaked[account]      -= amount;
        totalUSDCDeposited        -= amount;
        if (totalStaked[account] == 0 && hasStaked[account]) {
            totalActiveStakers--;
            hasStaked[account] = false;
        }

        emit StakedTokensBurned(account, amount);
    }

    function earlyRedeem(address user,uint256 amount) external onlyOperatorOrOwner nonReentrant {
        _burn(user, amount);
        // update per‑user and global statistics
        require(totalStaked[user] >= amount, "stat underflow");
        totalStaked[user] -= amount;
        totalUSDCDeposited -= amount;
        if (totalStaked[user] == 0 && hasStaked[user]) {
            totalActiveStakers--;
            hasStaked[user] = false;
        }
        require(USDC.transfer(user, amount),"redeem fail");
        emit EarlyRedeemed(user, amount);
    }

    function adminUnlock(address user) external onlyOwner { unlockAt[user]=1; }

    /**
     * @notice Pause all critical functions (deposit/mint/redeem, etc.).
     *         Owner‑only. Recommended to call through multisig with timelock.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract after a pause() call.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Move accumulated USDC out to the treasury wallet.
     * @param to     destination address (treasury / multisig)
     * @param amount amount of USDC to transfer
     */
    function sweepUSDC(address to, uint256 amount)
        external
        onlyOperatorOrOwner
        nonReentrant
    {
        require(to != address(0), "to=0");
        require(USDC.transfer(to, amount), "sweep fail");
        emit TreasurySweep(to, amount);
    }

    /**
     * @notice Emergency: pull **all** USDC to owner in case of critical bug.
     *         Use only with multisig approval!
     */
    function emergencyWithdrawUSDC() external onlyOperatorOrOwner nonReentrant {
        uint256 bal = USDC.balanceOf(address(this));
        require(bal > 0, "no USDC");
        require(USDC.transfer(owner(), bal), "transfer fail");
        emit EmergencyWithdraw(owner(), bal);
    }

    /* internal helpers for daily limits reuse */
    function _checkDailyBefore(uint256 dep,uint256 mint_) internal {
        uint256 today = block.timestamp / 1 days;
        if (today > currentDay) {
            currentDay=today;
            dailyDepositVolume=0;
            dailyMintVolume=0;
        }
        require(dailyDepositVolume + dep   <= DAILY_DEPOSIT_LIMIT, "deposit/day");
        require(dailyMintVolume    + mint_ <= DAILY_MINT_LIMIT,    "mint/day");
    }
    function _updateDailyAfter(uint256 dep,uint256 mint_) internal {
        dailyDepositVolume += dep;
        dailyMintVolume    += mint_;
    }

    /* ---------------------------------------------------------------------- */
    /*                        Batch / Utility functions                       */
    /* ---------------------------------------------------------------------- */

    /// @notice Batch deposit where owner supplies USDC once.
    function batchDepositAndMint(
        address[] calldata users,
        uint256[] calldata amounts,
        uint40 lockPeriod
    ) external onlyOperatorOrOwner whenNotPaused nonReentrant {
        require(users.length == amounts.length, "length");
        require(users.length <= 50, "too many");
        require(
            lockPeriod >= MIN_LOCK_PERIOD && lockPeriod <= MAX_LOCK_PERIOD,
            "lock"
        );

        uint256 totalAmt = 0;
        for (uint256 i; i < amounts.length; ++i) totalAmt += amounts[i];

        _checkDailyBefore(totalAmt, totalAmt);

        require(
            USDC.transferFrom(_msgSender(), address(this), totalAmt),
            "pull fail"
        );

        uint40 lockUntil = uint40(block.timestamp) + lockPeriod;
        for (uint256 i; i < users.length; ++i) {
            require(amounts[i] > 0, "amt=0");
            address u = users[i];
            _mint(u, amounts[i]);
            if (unlockAt[u] <= 1 || unlockAt[u] < lockUntil) {
                unlockAt[u] = lockUntil;           // do not shorten longer lock
            }
            totalStaked[u] += amounts[i];

            if (!hasStaked[u]) {
                hasStaked[u] = true;
                totalActiveStakers++;
            }
            emit Deposited(u, amounts[i], lockUntil);
        }

        _updateDailyAfter(totalAmt, totalAmt);
        totalUSDCDeposited += totalAmt;
    }

    /// @notice Batch deposit where each user pays own USDC.
    function batchDepositAndMintSelfPay(
        address[] calldata users,
        uint256[] calldata amounts,
        uint40 lockPeriod
    ) external onlyOperatorOrOwner whenNotPaused nonReentrant {
        require(users.length == amounts.length, "length");
        require(users.length <= 30, "too many");
        require(
            lockPeriod >= MIN_LOCK_PERIOD && lockPeriod <= MAX_LOCK_PERIOD,
            "lock"
        );

        uint256 totalAmt = 0;
        for (uint256 i; i < amounts.length; ++i) totalAmt += amounts[i];

        _checkDailyBefore(totalAmt, totalAmt);

        uint40 lockUntil = uint40(block.timestamp) + lockPeriod;
        for (uint256 i; i < users.length; ++i) {
            require(amounts[i] > 0, "amt=0");
            address u = users[i];
            require(
                USDC.transferFrom(u, address(this), amounts[i]),
                "pull fail"
            );
            _mint(u, amounts[i]);
            if (unlockAt[u] <= 1 || unlockAt[u] < lockUntil) {
                unlockAt[u] = lockUntil;           // do not shorten longer lock
            }
            totalStaked[u] += amounts[i];

            if (!hasStaked[u]) {
                hasStaked[u] = true;
                totalActiveStakers++;
            }
            emit Deposited(u, amounts[i], lockUntil);
        }

        _updateDailyAfter(totalAmt, totalAmt);
        totalUSDCDeposited += totalAmt;
    }

    /// @notice Recover non‑core tokens accidentally sent
    function recoverToken(address token,uint256 amount) external onlyOwner nonReentrant {
        require(token != address(USDC),"noUSDC");
        require(token != address(this),"nosUSDC");
        require(IERC20(token).transfer(owner(), amount), "recover fail");
        emit TokenRecovered(token, owner(), amount);
    }

    /// @notice Migrate lock params for user (upgrade helper)
    function migrateUserLock(address user,uint40 ts,uint256 staked) external onlyOwner {
        unlockAt[user]=ts;
        if(staked>0) totalStaked[user]=staked;
        bool wasStaker = hasStaked[user];
        if (staked > 0) {
            if (!wasStaker) { hasStaked[user] = true; totalActiveStakers++; }
        } else {
            if (wasStaker) { hasStaked[user] = false; totalActiveStakers--; }
        }
    }

    /* ------------------------------ User actions ------------------------------ */

    function unlock() external {
        uint40 ts = unlockAt[msg.sender];
        require(ts>1,"none");
        require(block.timestamp>=ts,"locked");
        unlockAt[msg.sender]=1;
        emit Unlocked(msg.sender);
    }

    /* ---------------------------------------------------------------------- */
    /*                              VIEW HELPERS                              */
    /* ---------------------------------------------------------------------- */

    /// @notice Seconds remaining until unlock for `user` (0 if unlocked).
    function getRemainingLockTime(address user) public view returns (uint40) {
        uint40 ts = unlockAt[user];
        if (ts <= 1 || block.timestamp >= ts) return 0;
        unchecked {
            return ts - uint40(block.timestamp);
        }
    }

    /// @notice Detailed staking info for frontend dashboards
    function getUserInfo(address user)
        external
        view
        returns (
            bool isLocked,
            uint40 remainingTime,
            uint256 totalBalance,
            uint256 stakedAmount
        )
    {
        uint40 ts = unlockAt[user];
        isLocked = ts > 1 && block.timestamp < ts;
        remainingTime = isLocked ? ts - uint40(block.timestamp) : 0;
        totalBalance = balanceOf(user);
        stakedAmount = totalStaked[user];
    }

    /// @notice Return actions available for the user (UI helper)
    function getAvailableActions(address user)
        external
        view
        returns (
            bool canTransfer,
            bool canApprove,
            bool canUnlock,
            bool canTradeOnDex
        )
    {
        bool isUnlocked = _isUnlocked(user);
        bool hasBalance = balanceOf(user) > 0;
        uint40 ts = unlockAt[user];

        canTransfer = isUnlocked && hasBalance && !paused();
        canApprove = (isUnlocked || user == owner()) && !paused();
        canUnlock = ts > 1 && block.timestamp >= ts;
        canTradeOnDex = isUnlocked && hasBalance && !paused();
    }

    /// @notice Daily limit usage snapshot
    function getDailyLimitStatus()
        external
        view
        returns (
            uint256 depositUsed,
            uint256 depositLimit,
            uint256 mintUsed,
            uint256 mintLimit,
            uint256 resetTime
        )
    {
        uint256 today = block.timestamp / 1 days;
        if (today > currentDay) {
            depositUsed = 0;
            mintUsed = 0;
        } else {
            depositUsed = dailyDepositVolume;
            mintUsed = dailyMintVolume;
        }
        depositLimit = DAILY_DEPOSIT_LIMIT;
        mintLimit = DAILY_MINT_LIMIT;
        resetTime = (today + 1) * 1 days;
    }

    /// @notice Global protocol stats
    function getProtocolStats()
        external
        view
        returns (
            uint256 totalSupply_,
            uint256 totalDeposited,
            uint256 totalRewards,
            uint256 activeStakers,
            uint256 contractUSDCBalance,
            bool isPaused_
        )
    {
        totalSupply_ = totalSupply();
        totalDeposited = totalUSDCDeposited;
        totalRewards = totalRewardsDistributed;
        activeStakers = totalActiveStakers;
        contractUSDCBalance = USDC.balanceOf(address(this));
        isPaused_ = paused();
    }

    /// @notice Very rough APY estimate (for UI only)
    function estimateAPY(address /*user*/ ) external view returns (uint256) {
        if (totalSupply() == 0 || totalUSDCDeposited == 0) return 0;
        // divide first to avoid potential overflow
        uint256 yearlyRewardPerUSDC = (totalRewardsDistributed * 365 days) / (totalUSDCDeposited * 1 days);
        return yearlyRewardPerUSDC * 10000;   // basis‑points
    }

    /// @notice Is address a staker?
    function isStaker(address user) external view returns (bool) {
        return totalStaked[user] > 0 ||
               balanceOf(user) > 0 ||
               unlockAt[user] > 0;
    }

    /* ------------------------------ ERC20 hooks ------------------------------- */

    function _update(address from,address to,uint256 amount) internal override {
        if(from==address(0) || to==address(0)) {
            super._update(from,to,amount);
            if(to==address(0)) _autoUnlock(from);
            return;
        }

        if(isDex[msg.sender]||isDex[from]||isDex[to]) {
            require(_isUnlocked(from),"dex locked");
            require(!paused(), "paused");
            super._update(from,to,amount);
            _autoUnlock(from);
            return;
        }

        require(_isUnlocked(from) && _isUnlocked(to),"locked");
        require(!paused(), "paused");
        super._update(from,to,amount);
        _autoUnlock(from);
    }

    /* ------------------------- Modifiers for operator ------------------------- */
    modifier onlyOperatorOrOwner() {
        require(
            _msgSender() == owner() || hasRole(OPERATOR_ROLE, _msgSender()),
            "not operator/owner"
        );
        _;
    }

    /* --------------------------- Storage gap 4 future ------------------------- */
    uint256[50] private __gap;
}