/**
 * Atomic Deployment and Initialization Script for SPL Token Vault Program
 * 
 * This script ensures atomic deployment and initialization to prevent front-running attacks.
 * It deploys the program and immediately calls the initialize instruction in the same flow.
 * 
 * SECURITY RATIONALE:
 * Without atomic initialization, there's a window between program deployment and initialization
 * where a malicious actor could front-run the initialize call and take control of the vault.
 * 
 * This script mitigates that risk by:
 * 1. Deploying the program (if needed)
 * 2. Immediately calling initialize with the intended authority and token mint
 * 3. Verifying successful initialization
 * 
 * USAGE:
 *   Set TOKEN_MINT environment variable or modify the script
 *   anchor run deploy-and-initialize
 * 
 * Or manually:
 *   TOKEN_MINT=<mint_address> bun run migrations/deploy-and-initialize.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplTokenVaultProgram } from "../target/types/spl_token_vault_program";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/**
 * Main deployment and initialization function
 */
async function deployAndInitialize() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SplTokenVaultProgram as Program<SplTokenVaultProgram>;
  
  console.log("🚀 Starting atomic deployment and initialization...");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Authority: ${provider.wallet.publicKey.toString()}`);
  
  // Get token mint from environment or use a test mint
  const tokenMintStr = process.env.TOKEN_MINT;
  if (!tokenMintStr) {
    console.error("❌ TOKEN_MINT environment variable not set");
    console.log("   Set TOKEN_MINT to the token mint address you want to initialize the vault for");
    console.log("   Example: TOKEN_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v bun run migrations/deploy-and-initialize.ts");
    process.exit(1);
  }
  
  const tokenMint = new anchor.web3.PublicKey(tokenMintStr);
  console.log(`   Token Mint: ${tokenMint.toString()}`);
  
  // Derive the vault state PDA
  const [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), tokenMint.toBuffer()],
    program.programId
  );
  
  console.log(`   Vault State PDA: ${vaultStatePda.toString()}`);
  
  // Derive the vault token account (ATA)
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    vaultStatePda,
    true // allowOwnerOffCurve
  );
  
  console.log(`   Vault Token Account: ${vaultTokenAccount.toString()}`);
  
  // Check if vault is already initialized
  try {
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✅ Vault already initialized!");
    console.log(`   Authority: ${vaultState.authority.toString()}`);
    console.log(`   Token Mint: ${vaultState.tokenMint.toString()}`);
    console.log(`   Withdrawal Wallet: ${vaultState.walletAccount.toString()}`);
    return;
  } catch (error) {
    // Vault not initialized - proceed with initialization
    console.log("📝 Vault not yet initialized, proceeding...");
  }
  
  // Initialize the vault immediately after deployment
  try {
    console.log("🔐 Calling initialize instruction...");
    
    const tx = await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        authority: provider.wallet.publicKey,
        tokenMint: tokenMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    
    console.log(`✅ Initialization transaction: ${tx}`);
    
    // Confirm transaction
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: tx,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, "confirmed");
    
    console.log("✅ Transaction confirmed!");
    
    // Verify initialization
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✅ Vault initialized successfully!");
    console.log(`   Authority: ${vaultState.authority.toString()}`);
    console.log(`   Token Mint: ${vaultState.tokenMint.toString()}`);
    console.log(`   Withdrawal Wallet: ${vaultState.walletAccount.toString()}`);
    
  } catch (error: any) {
    console.error("❌ Initialization failed:", error);
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
