import { ethers, upgrades } from "hardhat";
import { StakeableAssetImpl, StrategyRouter, VenusUSDCVault } from "../typechain-types";

async function main() {
  console.log("Starting SoulPeg deployment...");

  // Get deployment configuration from environment
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const VENUS_USDC_ADDRESS = process.env.VENUS_USDC_ADDRESS;
  const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;

  if (!USDC_ADDRESS || !VENUS_USDC_ADDRESS) {
    throw new Error("Missing required environment variables. Check .env file.");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy StakeableAssetImpl
  console.log("\n1. Deploying StakeableAssetImpl...");
  const StakeableAssetFactory = await ethers.getContractFactory("StakeableAssetImpl");
  const stakeableAsset = await upgrades.deployProxy(
    StakeableAssetFactory,
    [USDC_ADDRESS, "Soulbound USDC", "sUSDC"],
    { kind: "transparent" }
  ) as StakeableAssetImpl;
  await stakeableAsset.deployed();
  console.log("StakeableAssetImpl deployed to:", stakeableAsset.address);

  // Deploy StrategyRouter
  console.log("\n2. Deploying StrategyRouter...");
  const StrategyRouterFactory = await ethers.getContractFactory("StrategyRouter");
  const strategyRouter = await StrategyRouterFactory.deploy(USDC_ADDRESS) as StrategyRouter;
  await strategyRouter.deployed();
  console.log("StrategyRouter deployed to:", strategyRouter.address);

  // Deploy VenusUSDCVault
  console.log("\n3. Deploying VenusUSDCVault...");
  const VenusUSDCVaultFactory = await ethers.getContractFactory("VenusUSDCVault");
  const venusVault = await VenusUSDCVaultFactory.deploy(
    USDC_ADDRESS,
    VENUS_USDC_ADDRESS
  ) as VenusUSDCVault;
  await venusVault.deployed();
  console.log("VenusUSDCVault deployed to:", venusVault.address);

  // Configure StrategyRouter
  console.log("\n4. Configuring StrategyRouter...");
  const addStrategyTx = await strategyRouter.addStrategy(venusVault.address, 10000); // 100%
  await addStrategyTx.wait();
  console.log("Venus strategy added with 100% weight");

  // Set router address in StakeableAsset
  console.log("\n5. Setting router address in StakeableAsset...");
  const setRouterTx = await stakeableAsset.setStrategyRouter(strategyRouter.address);
  await setRouterTx.wait();
  console.log("Router address set");

  // Transfer ownership to multisig if provided
  if (MULTISIG_ADDRESS) {
    console.log("\n6. Transferring ownership to multisig...");
    
    // StakeableAsset uses 2-step ownership transfer
    const transferOwnershipTx = await stakeableAsset.transferOwnership(MULTISIG_ADDRESS);
    await transferOwnershipTx.wait();
    console.log("StakeableAsset ownership transfer initiated");
    console.log("Multisig must call acceptOwnership() to complete transfer");

    // StrategyRouter direct transfer
    const routerTransferTx = await strategyRouter.transferOwnership(MULTISIG_ADDRESS);
    await routerTransferTx.wait();
    console.log("StrategyRouter ownership transferred");
  }

  console.log("\n✅ Deployment complete!");
  console.log("\nDeployed addresses:");
  console.log("StakeableAssetImpl:", stakeableAsset.address);
  console.log("StrategyRouter:", strategyRouter.address);
  console.log("VenusUSDCVault:", venusVault.address);
  
  console.log("\n⚠️  Important: Save these addresses in a secure location!");
  console.log("⚠️  Remember to verify contracts on BSCScan");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });