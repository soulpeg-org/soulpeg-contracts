// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* ─────────────────────────────────────────────────────────────────────────────
 *  StrategyRouter
 *  ‑ routes USDC into a set of ERC‑4626 strategies according to weight (bps)
 *  ‑ can be extended/updated by the owner without touching the core token
 *  ────────────────────────────────────────────────────────────────────────────*/

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StrategyRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* --------------------------------------------------------------------- */
    /* data structures                                                       */
    /* --------------------------------------------------------------------- */
    struct StrategyInfo {
        IERC4626 strat; // ERC‑4626 vault
        uint16 weightBps; // weight in basis‑points (10000 = 100 %)
        bool active; // toggle without removing
    }

    /* --------------------------------------------------------------------- */
    /* state                                                                 */
    /* --------------------------------------------------------------------- */
    IERC20 public immutable asset; // underlying token (USDC)
    StrategyInfo[] public strategies; // dynamic list
    uint16 public totalWeightBps; // sum of active weights (<= 10000)

    /* --------------------------------------------------------------------- */
    /* events                                                                */
    /* --------------------------------------------------------------------- */
    event StrategyAdded(uint256 indexed id, address strat, uint16 weightBps);
    event StrategyUpdated(uint256 indexed id, uint16 newWeightBps, bool active);
    event DepositRouted(address indexed from, uint256 amount);
    event RedeemRouted(address indexed to, uint256 amount);

    /* --------------------------------------------------------------------- */
    /* ctor                                                                  */
    /* --------------------------------------------------------------------- */
    constructor(IERC20 _asset) Ownable(msg.sender) {
        require(address(_asset) != address(0), "asset=0");
        asset = _asset;
    }

    /* --------------------------------------------------------------------- */
    /* owner: manage strategies                                              */
    /* --------------------------------------------------------------------- */

    /// @notice add a new strategy; weights expressed in basis‑points
    function addStrategy(
        IERC4626 _strat,
        uint16 _weightBps
    ) external onlyOwner {
        require(address(_strat) != address(0), "strat=0");
        require(_weightBps > 0 && _weightBps <= 10_000, "weight out of range");
        _checkDecimals(_strat);

        strategies.push(
            StrategyInfo({strat: _strat, weightBps: _weightBps, active: true})
        );

        _ensureStrategyApproval(_strat);
        
        totalWeightBps += _weightBps;
        require(totalWeightBps <= 10_000, "total weight >100%");
        emit StrategyAdded(strategies.length - 1, address(_strat), _weightBps);
    }

    /// @notice update weight / active flag for existing strategy
    function updateStrategy(
        uint256 id,
        uint16 newWeightBps,
        bool active
    ) external onlyOwner {
        StrategyInfo storage info = _strategyAt(id);

        // если отключаем стратегию — принудительно вес 0
        uint16 effectiveNewWeight = active ? newWeightBps : 0;

        // пересчёт общей суммы весов
        totalWeightBps = totalWeightBps - info.weightBps + effectiveNewWeight;
        require(totalWeightBps <= 10_000, "total weight >100%");

        info.weightBps = effectiveNewWeight;
        info.active = active;

        emit StrategyUpdated(id, effectiveNewWeight, active);
    }

    /**
     * @notice Owner helper: explicitly approve the Router’s USDC for another
     *         contract (e.g. a strategy) using the safe “approve‑0‑approve” pattern.
     * @param spender  Contract that will spend the USDC (e.g. strategy vault)
     * @param amount   Max allowance to set. Use type(uint256).max for “infinite”.
     */
    function approveUSDC(address spender, uint256 amount) external onlyOwner {
        require(spender != address(0), "spender=0");
        // reset to zero first to mitigate issues with some ERC‑20 implementations
        asset.forceApprove(spender, 0);
        asset.forceApprove(spender, amount);
    }

    /* --------------------------------------------------------------------- */
    /* user‑facing liquidity functions                                       */
    /* --------------------------------------------------------------------- */

    /// @notice routes `amount` of asset from caller into strategies by weights
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");

        /* ── 1. забираем USDC у пользователя ─────────────────────────────── */
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _routeDeposit(amount);
        emit DepositRouted(msg.sender, amount);
    }

    /// @notice Invest USDC that is already held by the Router itself.
    function investReserve(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount=0");
        uint256 bal = asset.balanceOf(address(this));
        require(bal >= amount, "insufficient reserve");
        _routeDeposit(amount);
        emit DepositRouted(address(this), amount);
    }

    /* ─────────────────────────  External  ───────────────────────── */
    /// @notice Only owner: pulls `amount` of asset to `to`; uses reserve first, then strategies
    function redeem(uint256 amount, address to) external onlyOwner nonReentrant {
        require(amount > 0, "amount=0");

        uint256 bal = asset.balanceOf(address(this));
        if (bal < amount) {
            _redeemFromStrategies(amount - bal); // тянем недостающее
        }

        asset.safeTransfer(to, amount);
        emit RedeemRouted(to, amount); // переиспользуем существующее событие
    }

    /* --------------------------------------------------------------------- */
    /* view functions                                                        */
    /* --------------------------------------------------------------------- */

    function strategiesLength() external view returns (uint256) {
        return strategies.length;
    }

    /// @notice overall USDC backing held by this router (reserve + strategies)
    function totalAssets() public view returns (uint256 sum) {
        sum = asset.balanceOf(address(this));

        uint256 len = strategies.length;
        for (uint256 i = 0; i < len; ++i) {
            StrategyInfo storage info = strategies[i];
            if (!info.active) continue;
            uint256 shares = info.strat.balanceOf(address(this));
            if (shares == 0) continue;
            sum += info.strat.previewRedeem(shares);
        }
    }

    /* --------------------------------------------------------------------- */
    /* internal helpers                                                      */
    /* --------------------------------------------------------------------- */

    /* ─────────────────────────  Internal  ───────────────────────── */
    function _routeDeposit(uint256 amount) internal {
        /* ── 2. первый проход: считаем сумму весов активных стратегий
            и запоминаем индекс последней активной ────────────────────── */
        uint256 activeWeightSum = 0;
        uint256 lastActiveIdx = type(uint256).max; // sentinel
        uint256 len = strategies.length;

        for (uint256 i; i < len; ++i) {
            StrategyInfo storage inf = strategies[i];
            if (inf.active && inf.weightBps != 0) {
                activeWeightSum += inf.weightBps;
                lastActiveIdx = i; // последняя активная
            }
        }
        require(activeWeightSum != 0, "no active strategy");

        /* ── 3. второй проход: распределяем средства пропорционально ─────── */
        uint256 remaining = amount;

        for (uint256 i; i < len; ++i) {
            StrategyInfo storage inf = strategies[i];
            if (!inf.active || inf.weightBps == 0) continue;

            uint256 part = (i == lastActiveIdx)
                ? remaining // отдаём весь хвост
                : (amount * inf.weightBps) / activeWeightSum;

            if (part == 0) continue; // пропускаем пыль
            remaining -= part;

            inf.strat.deposit(part, address(this));
        }
    }

    function _redeemFromStrategies(uint256 need) internal {
        uint256 len = strategies.length;

        for (uint256 i; i < len && need > 0; ++i) {
            StrategyInfo storage inf = strategies[i];

            uint256 shares = inf.strat.balanceOf(address(this));
            if (shares == 0) continue;

            uint256 maxAssets = inf.strat.previewRedeem(shares);
            uint256 toPull = need < maxAssets ? need : maxAssets;
            if (toPull == 0) continue;

            uint256 sharesToRedeem = inf.strat.previewWithdraw(toPull);
            inf.strat.redeem(sharesToRedeem, address(this), address(this));

            need -= toPull;
        }

        require(need == 0, "insufficient liquidity");
    }

    function _strategyAt(
        uint256 id
    ) internal view returns (StrategyInfo storage info) {
        require(id < strategies.length, "strategy id oob");
        info = strategies[id];
    }

    function _ensureStrategyApproval(IERC4626 strat) internal {
        asset.forceApprove(address(strat), 0);
        asset.forceApprove(address(strat), type(uint256).max);
    }

    function _checkDecimals(IERC4626 strat) internal view {
        require(strat.asset() == address(asset), "mismatched asset");

        uint8 vaultDec = IERC20Metadata(address(strat)).decimals();
        uint8 baseDec = IERC20Metadata(address(asset)).decimals();

        require(vaultDec == 18 || vaultDec == baseDec, "unsupported decimals");
    }
}
