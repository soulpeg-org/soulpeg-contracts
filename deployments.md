# SoulPeg Deployments

## Network Information

SoulPeg is deployed on **BNB Chain (BSC)** mainnet.

### Supported Networks
- ✅ BNB Chain Mainnet (Chain ID: 56)
- ✅ BNB Chain Testnet (Chain ID: 97)

## Contract Architecture

### Core Contracts

1. **StakeableAssetImpl (sUSDC)**
   - Upgradeable ERC20 token with soul-bound mechanics
   - Implements time-locked staking functionality
   - Manages user deposits and reward distribution

2. **StrategyRouter**
   - Routes USDC deposits to yield strategies
   - Manages strategy weights and allocations
   - Handles withdrawals from yield sources

3. **VenusUSDCVault**
   - ERC-4626 compliant vault
   - Integrates with Venus Protocol for yield generation
   - Manages vUSDC tokens and interest accrual

### External Dependencies

- **USDC**: Official Circle USDC on BSC
  - Contract: [BSCScan](https://bscscan.com/token/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d)
  - Decimals: 18

- **Venus Protocol vUSDC**
  - Contract: [BSCScan](https://bscscan.com/address/0xEca88125A5AdBe82614fFc12d0Db554E2E2867C8)
  - Used for yield generation

## Deployment Process

### Prerequisites
1. Deploy StakeableAssetImpl implementation
2. Deploy TransparentUpgradeableProxy pointing to implementation
3. Deploy StrategyRouter
4. Deploy VenusUSDCVault
5. Configure strategy weights in StrategyRouter
6. Transfer ownership to multisig

### Verification
All contracts are verified on BSCScan for transparency. Source code matches this repository.

### Proxy Information
StakeableAssetImpl uses OpenZeppelin's TransparentUpgradeableProxy pattern:
- Implementation can be upgraded by proxy admin
- Proxy admin should be transferred to multisig
- Users interact with proxy address, not implementation

## Integration Information

### For DEX Integration
DEXes must be whitelisted to enable sUSDC transfers:
- Contact team for whitelisting
- Provide DEX pair contract address
- Wait for governance approval

### For Developers
1. Use proxy address for all interactions
2. Import ABIs from `/abi` directory
3. Check lock status before transfers
4. Handle custom errors appropriately

## Security Considerations

- All owner functions controlled by multisig
- Timelock recommended for critical operations
- Emergency pause available if needed
- Daily limits enforce gradual growth

## Gas Optimization

Typical gas costs (BSC):
- Deposit: ~250,000 gas
- Reward claim: ~120,000 gas  
- Transfer (when unlocked): ~65,000 gas
- Unlock: ~45,000 gas

## Support

For integration support or questions:
- Documentation: https://docs.soulpeg.com
- Discord: https://discord.gg/soulpeg
- Email: dev@soulpeg.com