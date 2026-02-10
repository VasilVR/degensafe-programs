/**
 * Devnet Deployment Script for Stake Program
 *
 * This script handles test token creation for devnet testing:
 * 1. Creates test SPL token mints (stake token + reward token)
 * 2. Mints tokens to the deployer wallet
 * 3. Mints tokens to additional test wallets (if specified)
 *
 * NOTE: This script does NOT create staking pools. Pool creation is done
 * through the Admin UI at /admin/staking after configuring the program ID.
 *
 * PREREQUISITES:
 * - Solana CLI configured for devnet: `solana config set --url devnet`
 * - Wallet with devnet SOL: `solana airdrop 2`
 * - Stake program already deployed to devnet
 *
 * USAGE:
 *   # Basic usage (mints tokens to deployer only)
 *   bun run migrations/devnet-deploy.ts
 *
 *   # Mint to additional wallets
 *   ADDITIONAL_WALLETS="wallet1,wallet2,wallet3" bun run migrations/devnet-deploy.ts
 *
 *   # Specify custom amounts
 *   MINT_AMOUNT=1000000000000 bun run migrations/devnet-deploy.ts
 *
 * ENVIRONMENT VARIABLES:
 *   ADDITIONAL_WALLETS - Comma-separated list of wallet addresses to mint tokens to
 *   MINT_AMOUNT - Amount of tokens to mint per wallet (in raw units, default: 1_000_000_000_000 = 1M tokens with 6 decimals)
 */

import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// Configuration
const TOKEN_DECIMALS = 6;
const DEFAULT_MINT_AMOUNT = 1_000_000_000_000n; // 1M tokens with 6 decimals

// Stake Program ID (deployed to devnet)
const STAKE_PROGRAM_ID = "C8f5r1DTWDbhCA8Ci6TNdQJBAZg4SuBCkXP49r9BE8i5";

interface DeploymentResult {
  stakeProgramId: string;
  tokenMint: string;
  rewardMint: string;
  tokenDecimals: number;
  mintedTo: string[];
}

async function devnetDeploy(): Promise<DeploymentResult> {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet.publicKey;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   🪙 TEST TOKEN DEPLOYMENT FOR STAKE PROGRAM");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`   Stake Program ID: ${STAKE_PROGRAM_ID}`);
  console.log(`   Deployer Wallet: ${admin.toString()}`);
  console.log(`   Cluster: ${provider.connection.rpcEndpoint}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Parse environment variables
  const additionalWalletsStr = process.env.ADDITIONAL_WALLETS || "";
  const mintAmount = BigInt(process.env.MINT_AMOUNT || DEFAULT_MINT_AMOUNT.toString());

  const additionalWallets = additionalWalletsStr
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .map((w) => new anchor.web3.PublicKey(w));

  const allRecipients = [admin, ...additionalWallets];

  console.log("📋 Configuration:");
  console.log(`   Token Decimals: ${TOKEN_DECIMALS}`);
  console.log(`   Mint Amount per Wallet: ${Number(mintAmount) / 10 ** TOKEN_DECIMALS} tokens`);
  console.log(`   Recipients: ${allRecipients.length} wallet(s)`);
  console.log("");

  // Check SOL balance
  const balance = await provider.connection.getBalance(admin);
  console.log(`💰 Deployer SOL Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  if (balance < 0.5 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log("⚠️  Warning: Low SOL balance. Consider running: solana airdrop 2");
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // Step 1: Create Token Mints
  // ═══════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 1: Creating Token Mints");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("📝 Creating staking token mint...");
  const tokenMint = await createMint(
    provider.connection,
    payer,
    admin, // mint authority
    null, // freeze authority (none)
    TOKEN_DECIMALS
  );
  console.log(`   ✅ Staking Token Mint: ${tokenMint.toString()}`);

  console.log("\n📝 Creating reward token mint...");
  const rewardMint = await createMint(
    provider.connection,
    payer,
    admin, // mint authority
    null, // freeze authority (none)
    TOKEN_DECIMALS
  );
  console.log(`   ✅ Reward Token Mint: ${rewardMint.toString()}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // Step 2: Mint Tokens to Recipients
  // ═══════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   STEP 2: Minting Tokens to Recipients");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const mintedTo: string[] = [];

  for (const recipient of allRecipients) {
    console.log(`📤 Minting to: ${recipient.toString()}`);

    // Create/get staking token ATA and mint
    const stakingAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      tokenMint,
      recipient
    );
    await mintTo(
      provider.connection,
      payer,
      tokenMint,
      stakingAta.address,
      admin,
      mintAmount
    );
    console.log(`   ✅ Staking tokens: ${Number(mintAmount) / 10 ** TOKEN_DECIMALS} tokens`);

    // Create/get reward token ATA and mint
    const rewardAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      rewardMint,
      recipient
    );
    await mintTo(
      provider.connection,
      payer,
      rewardMint,
      rewardAta.address,
      admin,
      mintAmount
    );
    console.log(`   ✅ Reward tokens: ${Number(mintAmount) / 10 ** TOKEN_DECIMALS} tokens`);
    console.log("");

    mintedTo.push(recipient.toString());
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   🎉 TEST TOKENS CREATED!");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const result: DeploymentResult = {
    stakeProgramId: STAKE_PROGRAM_ID,
    tokenMint: tokenMint.toString(),
    rewardMint: rewardMint.toString(),
    tokenDecimals: TOKEN_DECIMALS,
    mintedTo,
  };

  console.log("📋 Token Summary:");
  console.log(`   Staking Token Mint: ${result.tokenMint}`);
  console.log(`   Reward Token Mint: ${result.rewardMint}`);
  console.log(`   Decimals: ${result.tokenDecimals}`);
  console.log("");
  console.log("📤 Tokens minted to:");
  for (const wallet of result.mintedTo) {
    console.log(`   - ${wallet}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   📋 NEXT STEPS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("1. Configure the Stake Program in Admin UI:");
  console.log("   - Go to /admin/staking");
  console.log("   - In Configuration tab, set Program ID to:");
  console.log(`     ${STAKE_PROGRAM_ID}`);
  console.log("");

  console.log("2. Create a Staking Pool from Admin UI:");
  console.log("   - Go to 'Create Pool' tab");
  console.log("   - Token Mint (for staking):");
  console.log(`     ${result.tokenMint}`);
  console.log("   - Reward Mint:");
  console.log(`     ${result.rewardMint}`);
  console.log("   - Set desired APY (e.g., 1000 = 10%)");
  console.log("   - Click 'Create Pool' and sign the transaction");
  console.log("");

  console.log("3. Fund the Reward Vault:");
  console.log("   - After pool creation, expand the pool in 'My Pools' tab");
  console.log("   - Use 'Fund Reward Vault' to deposit reward tokens");
  console.log("");

  console.log("4. Activate the Pool:");
  console.log("   - Toggle 'Activate Pool' to allow staking");
  console.log("");

  console.log("📋 JSON Output:");
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Run the deployment
devnetDeploy()
  .then((result) => {
    console.log("\n✅ Test token deployment successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
