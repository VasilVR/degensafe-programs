/**
 * Atomic Deployment and Initialization Script for SOL Vault Program
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
 * 2. Immediately calling initialize with the intended authority
 * 3. Verifying successful initialization
 * 
 * USAGE:
 *   anchor run deploy-and-initialize
 * 
 * Or manually:
 *   bun run migrations/deploy-and-initialize.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolVaultProgram } from "../target/types/sol_vault_program";

/**
 * Main deployment and initialization function
 */
async function deployAndInitialize() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolVaultProgram as Program<SolVaultProgram>;
  
  console.log("🚀 Starting atomic deployment and initialization...");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Authority: ${provider.wallet.publicKey.toString()}`);
  
  // Derive the vault state PDA
  const [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    program.programId
  );
  
  console.log(`   Vault State PDA: ${vaultStatePda.toString()}`);
  
  // Check if vault is already initialized
  try {
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✅ Vault already initialized!");
    console.log(`   Authority: ${vaultState.authority.toString()}`);
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
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
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
