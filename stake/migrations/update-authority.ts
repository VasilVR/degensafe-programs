/**
 * Update Program Upgrade Authority
 *
 * This script transfers the upgrade authority of the stake program to a new wallet.
 *
 * USAGE:
 *   NEW_AUTHORITY=<wallet_address> bun run migrations/update-authority.ts
 *
 * ENVIRONMENT VARIABLES:
 *   NEW_AUTHORITY - The new upgrade authority wallet address (required)
 *   PROGRAM_ID - The program ID to update (default: stake program)
 */

import { execSync } from "child_process";

// Stake Program ID (deployed to devnet)
const DEFAULT_PROGRAM_ID = "C8f5r1DTWDbhCA8Ci6TNdQJBAZg4SuBCkXP49r9BE8i5";

async function updateAuthority() {
  const newAuthority = process.env.NEW_AUTHORITY;
  const programId = process.env.PROGRAM_ID || DEFAULT_PROGRAM_ID;

  if (!newAuthority) {
    console.error("❌ NEW_AUTHORITY environment variable is required");
    console.log("\nUsage:");
    console.log("  NEW_AUTHORITY=<wallet_address> bun run migrations/update-authority.ts");
    console.log("\nExample:");
    console.log("  NEW_AUTHORITY=t8KDUfMgGqKxxUe8MFdLQDkkqCCUfbt2Z5TLnm33c4y bun run migrations/update-authority.ts");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   🔐 UPDATE PROGRAM UPGRADE AUTHORITY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`   Program ID: ${programId}`);
  console.log(`   New Authority: ${newAuthority}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // First, show current authority
  console.log("📋 Current program info:");
  try {
    const showOutput = execSync(`solana program show ${programId}`, {
      encoding: "utf-8",
    });
    console.log(showOutput);
  } catch (error) {
    console.error("❌ Failed to get program info");
    throw error;
  }

  // Update authority
  console.log(`\n🔄 Transferring upgrade authority to ${newAuthority}...`);
  try {
    const updateOutput = execSync(
      `solana program set-upgrade-authority ${programId} --new-upgrade-authority ${newAuthority} --skip-new-upgrade-authority-signer-check`,
      { encoding: "utf-8" }
    );
    console.log(updateOutput);
    console.log("✅ Authority updated successfully!");
  } catch (error) {
    console.error("❌ Failed to update authority");
    throw error;
  }

  // Verify the change
  console.log("\n📋 Verifying new authority:");
  try {
    const verifyOutput = execSync(`solana program show ${programId}`, {
      encoding: "utf-8",
    });
    console.log(verifyOutput);
  } catch (error) {
    console.error("❌ Failed to verify");
    throw error;
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   ✅ AUTHORITY TRANSFER COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`   Program: ${programId}`);
  console.log(`   New Authority: ${newAuthority}`);
  console.log("═══════════════════════════════════════════════════════════════\n");
}

updateAuthority()
  .then(() => {
    console.log("✅ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  });
