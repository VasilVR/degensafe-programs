/**
 * Create Test Token Mints for Stake Program Testing
 *
 * This script creates dummy SPL token mints for testing the stake program in localnet.
 * It creates both a staking token mint and a reward token mint.
 * It outputs the mint addresses that can be used as environment variables.
 *
 * USAGE:
 *   bun run migrations/create-test-mints.ts
 *
 * Or via anchor:
 *   anchor run create-test-mints
 *
 * The script will output:
 *   export TOKEN_MINT=<mint_address>
 *   export REWARD_MINT=<mint_address>
 *
 * You can then use this in deployment:
 *   eval $(bun run migrations/create-test-mints.ts)
 *   anchor run deploy-and-initialize
 */

import * as anchor from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";

async function createTestMints() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("🪙 Creating test token mints for Stake Program...");
  console.log(`   Payer: ${provider.wallet.publicKey.toString()}`);

  try {
    // Create staking token mint
    console.log("\n📝 Creating staking token mint...");
    const tokenMint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey, // mint authority
      null, // freeze authority (none)
      6 // decimals
    );

    console.log("✅ Staking token mint created!");
    console.log(`   Mint Address: ${tokenMint.toString()}`);

    // Create reward token mint
    console.log("\n📝 Creating reward token mint...");
    const rewardMint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey, // mint authority
      null, // freeze authority (none)
      6 // decimals
    );

    console.log("✅ Reward token mint created!");
    console.log(`   Mint Address: ${rewardMint.toString()}`);

    console.log("\n✅ Test token mints created successfully!");
    console.log(`   Staking Token: ${tokenMint.toString()}`);
    console.log(`   Reward Token: ${rewardMint.toString()}`);
    console.log(`   Decimals: 6 (both)`);
    console.log(`   Mint Authority: ${provider.wallet.publicKey.toString()}`);

    console.log("\n📋 To use these mints with deploy-and-initialize:");
    console.log(`   export TOKEN_MINT=${tokenMint.toString()}`);
    console.log(`   export REWARD_MINT=${rewardMint.toString()}`);
    console.log(
      `   export REWARD_PERCENTAGE=1000  # Optional, default is 1000 (10% APY)`
    );
    console.log(`   anchor run deploy-and-initialize`);

    console.log("\n📋 Or in one command:");
    console.log(
      `   TOKEN_MINT=${tokenMint.toString()} REWARD_MINT=${rewardMint.toString()} anchor run deploy-and-initialize`
    );

    // Output for eval usage
    console.log(`\nexport TOKEN_MINT=${tokenMint.toString()}`);
    console.log(`export REWARD_MINT=${rewardMint.toString()}`);
    console.log(`export REWARD_PERCENTAGE=1000`);
  } catch (error: any) {
    console.error("❌ Failed to create test mints:", error);
    throw error;
  }
}

// Run the script
createTestMints()
  .then(() => {
    console.log("\n✅ Success!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
