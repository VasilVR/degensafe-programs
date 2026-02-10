/**
 * Create Test Token Mint for SPL Token Vault Testing
 * 
 * This script creates a dummy SPL token mint for testing the vault program in localnet.
 * It outputs the mint address that can be used as the TOKEN_MINT environment variable.
 * 
 * USAGE:
 *   bun run migrations/create-test-mint.ts
 * 
 * Or via anchor:
 *   anchor run create-test-mint
 * 
 * The script will output:
 *   export TOKEN_MINT=<mint_address>
 * 
 * You can then use this in deployment:
 *   eval $(bun run migrations/create-test-mint.ts)
 *   anchor run deploy-and-initialize
 */

import * as anchor from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";

async function createTestMint() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("🪙 Creating test token mint for SPL Token Vault...");
  console.log(`   Payer: ${provider.wallet.publicKey.toString()}`);
  
  try {
    // Create a new token mint
    const tokenMint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey, // mint authority
      null, // freeze authority (none)
      6 // decimals
    );

    console.log("\n✅ Test token mint created successfully!");
    console.log(`   Mint Address: ${tokenMint.toString()}`);
    console.log(`   Decimals: 6`);
    console.log(`   Mint Authority: ${provider.wallet.publicKey.toString()}`);
    
    console.log("\n📋 To use this mint with deploy-and-initialize:");
    console.log(`   export TOKEN_MINT=${tokenMint.toString()}`);
    console.log(`   anchor run deploy-and-initialize`);
    
    console.log("\n📋 Or in one command:");
    console.log(`   TOKEN_MINT=${tokenMint.toString()} anchor run deploy-and-initialize`);
    
    // Output for eval usage
    console.log(`\nexport TOKEN_MINT=${tokenMint.toString()}`);
    
  } catch (error: any) {
    console.error("❌ Failed to create test mint:", error);
    throw error;
  }
}

// Run the script
createTestMint()
  .then(() => {
    console.log("\n✅ Success!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
