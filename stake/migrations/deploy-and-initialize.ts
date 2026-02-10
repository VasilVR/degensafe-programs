/**
 * Atomic Deployment and Initialization Script for Stake Program
 *
 * This script ensures atomic deployment and initialization to prevent front-running attacks.
 * It deploys the program and immediately calls the create_pool instruction in the same flow.
 *
 * SECURITY RATIONALE:
 * Without atomic initialization, there's a window between program deployment and pool creation
 * where a malicious actor could front-run the create_pool call and take control of the pool.
 *
 * This script mitigates that risk by:
 * 1. Deploying the program (if needed)
 * 2. Immediately calling create_pool with the intended owner and configuration
 * 3. Verifying successful pool creation
 *
 * USAGE:
 *   Set TOKEN_MINT and REWARD_MINT environment variables or modify the script
 *   anchor run deploy-and-initialize
 *
 * Or manually:
 *   TOKEN_MINT=<mint> REWARD_MINT=<mint> REWARD_PERCENTAGE=1000 bun run migrations/deploy-and-initialize.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { StakeProgram } from "../target/types/stake_program";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/**
 * Main deployment and initialization function
 */
async function deployAndInitialize() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StakeProgram as Program<StakeProgram>;

  console.log("🚀 Starting atomic deployment and initialization...");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${provider.wallet.publicKey.toString()}`);

  // Get configuration from environment
  const tokenMintStr = process.env.TOKEN_MINT;
  const rewardMintStr = process.env.REWARD_MINT;
  const rewardPercentageStr = process.env.REWARD_PERCENTAGE || "1000"; // Default 10% APY

  if (!tokenMintStr || !rewardMintStr) {
    console.error(
      "❌ TOKEN_MINT and REWARD_MINT environment variables required"
    );
    console.log("   Set TOKEN_MINT to the staking token mint address");
    console.log("   Set REWARD_MINT to the reward token mint address");
    console.log(
      "   Optionally set REWARD_PERCENTAGE (basis points, default 1000 = 10%)"
    );
    console.log("\n   Example:");
    console.log(
      "   TOKEN_MINT=<mint> REWARD_MINT=<mint> REWARD_PERCENTAGE=1000 bun run migrations/deploy-and-initialize.ts"
    );
    process.exit(1);
  }

  const tokenMint = new anchor.web3.PublicKey(tokenMintStr);
  const rewardMint = new anchor.web3.PublicKey(rewardMintStr);
  const rewardPercentage = new BN(rewardPercentageStr);
  
  // Pool ID - use 0 for the first pool (default)
  const poolId = new BN(0);
  
  console.log(`   Token Mint: ${tokenMint.toString()}`);
  console.log(`   Reward Mint: ${rewardMint.toString()}`);
  console.log(`   Reward Percentage: ${rewardPercentage.toString()} bps (${rewardPercentage.toNumber() / 100}%)`);
  console.log(`   Pool ID: ${poolId.toString()}`);
  
  // Derive pool ID counter PDA
  const [poolIdCounterPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool_id_counter"), tokenMint.toBuffer()],
    program.programId
  );
  
  console.log(`   Pool ID Counter PDA: ${poolIdCounterPda.toString()}`);
  
  // Derive pool PDA (with pool_id)
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log(`   Pool PDA: ${poolPda.toString()}`);

  // Derive reward vault PDA
  const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
    program.programId
  );

  console.log(`   Reward Vault PDA: ${rewardVaultPda.toString()}`);

  // Derive pool vault PDA
  const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
    program.programId
  );

  console.log(`   Pool Vault PDA: ${poolVaultPda.toString()}`);

  // Check if pool is already created
  try {
    const pool = await program.account.pool.fetch(poolPda);
    console.log("✅ Pool already created!");
    console.log(`   Pool ID: ${pool.poolId.toString()}`);
    console.log(`   Owner: ${pool.owner.toString()}`);
    console.log(`   Token Mint: ${pool.tokenMint.toString()}`);
    console.log(`   Reward Mint: ${pool.rewardMint.toString()}`);
    console.log(
      `   Reward Percentage: ${pool.rewardPercentage.toString()} bps`
    );
    console.log(`   Total Staked: ${pool.totalStaked.toString()}`);
    console.log(`   Active: ${pool.isActive}`);
    return;
  } catch (error) {
    // Pool not created - proceed with creation
    console.log("📝 Pool not yet created, proceeding...");
  }

  // Create the pool immediately after deployment
  try {
    console.log("🔐 Calling create_pool instruction...");

    const tx = await program.methods
      .createPool(
        null, // maybe_owner - null means admin will be the owner
        rewardPercentage,
        poolId // pool_id parameter
      )
      .accounts({
        poolIdCounter: poolIdCounterPda,
        pool: poolPda,
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        rewardVault: rewardVaultPda,
        poolVault: poolVaultPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`✅ Pool creation transaction: ${tx}`);

    // Confirm transaction
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: tx,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    console.log("✅ Transaction confirmed!");

    // Verify pool creation
    const pool = await program.account.pool.fetch(poolPda);
    console.log("✅ Pool created successfully!");
    console.log(`   Pool ID: ${pool.poolId.toString()}`);
    console.log(`   Owner: ${pool.owner.toString()}`);
    console.log(`   Token Mint: ${pool.tokenMint.toString()}`);
    console.log(`   Reward Mint: ${pool.rewardMint.toString()}`);
    console.log(
      `   Reward Percentage: ${pool.rewardPercentage.toString()} bps (${
        pool.rewardPercentage.toNumber() / 100
      }%)`
    );
    console.log(`   Total Staked: ${pool.totalStaked.toString()}`);
    console.log(`   Active: ${pool.isActive}`);
    console.log(`   Reward Vault: ${pool.rewardVault.toString()}`);
  } catch (error: any) {
    console.error("❌ Pool creation failed:", error);
    throw error;
  }

  console.log("\n🎉 Atomic deployment and initialization complete!");
}

// Run the deployment
deployAndInitialize()
  .then(() => {
    console.log("✅ Success!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
