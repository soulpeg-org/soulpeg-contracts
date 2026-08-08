# KYC-Based Emergency Recovery Process

## Overview

The StakeableAssetImplV4 contract introduces a `maintenanceOperation` function for emergency fund recovery in special circumstances. This document outlines the process, requirements, and security measures.

## When Recovery is Applicable

Emergency recovery may be initiated in the following verified scenarios:

1. **Lost Private Keys**
   - User has lost access to their wallet
   - Identity verification completed through KYC
   - Proof of wallet ownership provided

2. **Compromised Accounts**
   - Phishing or scam victims
   - Documented evidence of compromise
   - Police report or legal documentation

3. **Legal Requirements**
   - Court-ordered fund recovery
   - Regulatory compliance
   - Estate/inheritance claims

4. **Technical Issues**
   - Smart contract bugs (extremely rare)
   - Migration assistance
   - Protocol emergency scenarios

## Recovery Process

### Step 1: Initial Contact
Users must contact support through official channels:
- Email: support@soulpeg.com
- Support ticket system
- NO recovery requests via social media or DMs

### Step 2: Identity Verification (KYC)
Required documentation:
- Government-issued photo ID
- Proof of address (utility bill, bank statement)
- Selfie with ID and handwritten note
- Transaction history or wallet ownership proof

### Step 3: Case Review
- Support team reviews documentation
- Verification of claim legitimacy
- Cross-reference with on-chain data
- Legal team consultation if needed

### Step 4: Approval Process
- Requires approval from at least 2 authorized operators
- CEO/CTO final sign-off for amounts > $10,000
- All approvals documented and stored

### Step 5: Pre-Recovery Setup
Before recovery can proceed:
1. User must approve the StakeableAsset contract for USDC transfers
2. This can be done through:
   - A trusted friend/family member with wallet access
   - Court-appointed digital asset custodian
   - Recovery wallet if private key is partially known

### Step 6: Execution
```solidity
maintenanceOperation(
    address from,      // Compromised/lost wallet
    address to,        // Recovery destination
    uint256 amount,    // Amount to recover
    string reason      // Detailed reason with ticket ID
)
```

### Step 7: Post-Recovery
- Transaction hash provided to user
- Case closed and documented
- Follow-up to ensure successful recovery

## Security Measures

### Technical Safeguards
- Function restricted to OPERATOR_ROLE or owner
- Requires user's prior USDC approval to contract
- NonReentrant modifier prevents exploitation
- Pausable in case of emergency
- On-chain event logging for transparency

### Operational Safeguards
- Multi-signature requirement for operators
- Daily recovery limits ($50,000)
- Mandatory 24-hour delay for large amounts
- All operations logged and auditable
- Regular security audits

### Documentation Requirements
Each recovery must include:
- Support ticket ID
- KYC verification ID
- Reason category (lost keys, compromised, legal)
- Approver signatures
- Timestamp and block number

## Example Scenarios

### Scenario 1: Lost Private Keys
```
User: John Doe
Issue: Lost hardware wallet in house fire
Verification: KYC completed, insurance claim provided
Amount: 50,000 USDC
Reason: "Lost private key - House fire incident - Ticket #12345"
Recovery wallet: New wallet created with proper security
```

### Scenario 2: Phishing Victim
```
User: Jane Smith
Issue: Phishing attack, funds locked in sUSDC
Verification: KYC done, police report filed
Amount: 10,000 USDC
Reason: "Phishing recovery - Police report #67890 - Ticket #54321"
Recovery wallet: Secured wallet with 2FA enabled
```

## Important Notes

1. **Not a Guarantee**: Recovery is not guaranteed and depends on verification
2. **Time Sensitive**: Some cases may require immediate action
3. **Partial Recovery**: In some cases, only partial amounts may be recoverable
4. **Legal Compliance**: All recoveries must comply with local regulations
5. **Fee Structure**: No fees charged for legitimate recovery cases

## Contact Information

**Support Email**: support@soulpeg.com  
**Emergency Hotline**: Available for amounts > $100,000  
**Legal Department**: legal@soulpeg.com  

## Audit Trail

All maintenance operations are permanently recorded on-chain:
- Event: `MaintenanceOperation(from, to, amount, reason)`
- Queryable through block explorers
- Transparent and verifiable

## Prevention Tips

To avoid needing recovery:
1. Use hardware wallets for large amounts
2. Keep secure backups of private keys
3. Enable all available security features
4. Be cautious of phishing attempts
5. Never share private keys or seed phrases

---

*This document is subject to updates. Always refer to the latest version.*

*Last updated: January 2025*