import { run } from "hardhat";

async function main() {
  // Get addresses from command line arguments or environment
  const STAKEABLE_ASSET = process.env.STAKEABLE_ASSET_ADDRESS;
  const STRATEGY_ROUTER = process.env.STRATEGY_ROUTER_ADDRESS;
  const VENUS_VAULT = process.env.VENUS_VAULT_ADDRESS;
  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const VENUS_USDC_ADDRESS = process.env.VENUS_USDC_ADDRESS;

  if (!STAKEABLE_ASSET || !STRATEGY_ROUTER || !VENUS_VAULT) {
    console.error("Missing contract addresses. Set environment variables.");
    return;
  }

  console.log("Verifying contracts on BSCScan...");

  // Verify StrategyRouter
  try {
    console.log("\nVerifying StrategyRouter...");
    await run("verify:verify", {
      address: STRATEGY_ROUTER,
      constructorArguments: [USDC_ADDRESS],
    });
    console.log("✅ StrategyRouter verified");
  } catch (error) {
    console.log("❌ StrategyRouter verification failed:", error);
  }

  // Verify VenusUSDCVault
  try {
    console.log("\nVerifying VenusUSDCVault...");
    await run("verify:verify", {
      address: VENUS_VAULT,
      constructorArguments: [USDC_ADDRESS, VENUS_USDC_ADDRESS],
    });
    console.log("✅ VenusUSDCVault verified");
  } catch (error) {
    console.log("❌ VenusUSDCVault verification failed:", error);
  }

  // Note: Proxy contracts require special verification process
  console.log("\n⚠️  StakeableAssetImpl is a proxy contract.");
  console.log("Use BSCScan's proxy verification interface to verify:");
  console.log("1. Verify the implementation contract");
  console.log("2. Verify the proxy contract");
  console.log("3. Link them using 'Verify Proxy' feature on BSCScan");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });