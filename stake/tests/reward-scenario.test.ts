import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment, advanceToSlot } from "./test-utils";

// Test constants for slot-based timing
// Using the same SLOTS_PER_YEAR constant as defined in the stake program (lib.rs)
// Calculation: 365.25 days * 24 hours * 60 minutes * 60 seconds * 2.5 slots/second ≈ 78,840,000
const SLOTS_PER_YEAR = 78_840_000; // Solana slots per year (matches program constant)
// Test duration: 200 slots total (scaled down for fast testing)
const TEST_TOTAL_SLOTS = 200; // Total test duration
const TEST_FIRST_PERIOD = 50; // First staking period (25% of total)
const TEST_SECOND_PERIOD = 50; // Second period after partial unstake (25% of total)
const TEST_THIRD_PERIOD = 100; // Final period (50% of total)
// 5% tolerance accounts for:
// 1. Approximate slot advancement in test environment (advanceToSlot may not advance exactly as requested)
// 2. Block production timing variability in localnet
// 3. Rounding in reward calculations (integer division, u128 arithmetic)
const REWARD_CALCULATION_TOLERANCE = 0.05;

describe("💰 Stake Program - Reward Scenario", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userTokenAccount: any;
  let userRewardAccount: any;
  let userStakePda: anchor.web3.PublicKey;
  let adminRewardAccount: any;
  let poolVaultPda: anchor.web3.PublicKey;
  let rewardVaultPda: anchor.web3.PublicKey;
  const poolId = new anchor.BN(0);

  // Track slots for cumulative advancement
  let stakeStartSlot: number;
  let currentTargetSlot: number = 0;
  let lastRewardClaimSlot: number;

  before(async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Create a token mint for staking
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6, // 6 decimals
      tokenMintKeypair
    );

    // Create a token mint for rewards
    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6, // 6 decimals
      rewardMintKeypair
    );

    // Create pool with 9.5% APY (950 basis points)
    const rewardPercentage = 950; // 9.5% APY in basis points
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    // Get pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("staking_pool"),
        tokenMint.toBuffer(),
        poolId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Enable staking
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Create user and token accounts
    user = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      user.publicKey
    );

    userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      user.publicKey
    );

    adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    // Mint 100,000 tokens to user (with 6 decimals = 100,000,000,000)
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      100_000_000_000
    );

    // Mint rewards to admin and deposit to pool
    // We need enough rewards to cover 200 slots at 9.5% APY on 100,000 tokens
    // 100,000 * 9.5% * (200/78,840,000) ≈ 0.024 tokens = 24,000 (with 6 decimals)
    // Add extra buffer for multiple withdrawals
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      100_000 // 0.1 reward tokens (extra buffer)
    );

    [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(100_000))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenMint: tokenMint,
      })
      .rpc();

    // Get user stake PDA
    [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Get pool vault PDA
    [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    console.log("✅ Setup complete");
    console.log("   Token mint:", tokenMint.toBase58());
    console.log("   Reward mint:", rewardMint.toBase58());
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   User:", user.publicKey.toBase58());
    console.log("   Initial reward rate: 9.5% APY (950 basis points)\n");
  });

  it("1. 💼 User stakes 100,000 tokens", async () => {
    const stakeAmount = new anchor.BN(100_000_000_000); // 100,000 tokens with 6 decimals

    await program.methods
      .depositStake(poolId, stakeAmount)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    // Record the slot when staking started
    stakeStartSlot = await provider.connection.getSlot();
    currentTargetSlot = stakeStartSlot;
    lastRewardClaimSlot = stakeStartSlot;

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("\n📊 Initial stake:");
    console.log(
      "   Staked amount:",
      userStakeInfo.amount.toNumber() / 1_000_000,
      "tokens"
    );
    console.log("   Stake started at slot:", stakeStartSlot);
    expect(userStakeInfo.amount.toNumber()).to.equal(100_000_000_000);
  });

  it("2. ⏰ Check rewards after first period (50 slots)", async () => {
    // Advance 50 slots from current position (cumulative)
    currentTargetSlot += TEST_FIRST_PERIOD;
    console.log("\n⏰ Advancing to slot", currentTargetSlot, "...");
    await advanceToSlot(provider, currentTargetSlot);

    const currentSlot = await provider.connection.getSlot();
    const slotsElapsed = currentSlot - stakeStartSlot;

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingReward = userStakeInfo.pendingReward.toNumber();
    const pendingRewardTokens = pendingReward / 1_000_000;

    console.log("\n📊 After first period:");
    console.log("   Current slot:", currentSlot);
    console.log("   Slots elapsed since stake:", slotsElapsed);
    console.log(
      "   Staked amount:",
      userStakeInfo.amount.toNumber() / 1_000_000,
      "tokens"
    );
    console.log("   Pending reward:", pendingRewardTokens, "tokens");

    // Calculate expected reward based on actual slots elapsed
    // reward = amount * rate * slots_elapsed / SLOTS_PER_YEAR / 10000
    const expectedReward = Math.floor(
      (100_000_000_000 * 950 * slotsElapsed) / SLOTS_PER_YEAR / 10000
    );
    const tolerance = Math.max(
      expectedReward * REWARD_CALCULATION_TOLERANCE,
      1000
    ); // minimum tolerance

    console.log(
      "   Expected reward: ~",
      expectedReward / 1_000_000,
      "tokens (with 5% tolerance)"
    );

    expect(pendingReward).to.be.greaterThan(0);
    expect(pendingReward).to.be.within(
      expectedReward - tolerance,
      expectedReward + tolerance
    );
  });

  it("3. 💸 User withdraws rewards after first period", async () => {
    const userStakeInfoBefore = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingRewardBefore = userStakeInfoBefore.pendingReward.toNumber();

    // Withdraw 0 tokens to claim rewards only
    await program.methods
      .withdrawStake(poolId, new anchor.BN(0))
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenMint: tokenMint,
        rewardMint: rewardMint,
      })
      .signers([user])
      .rpc();

    // Update last reward claim slot
    lastRewardClaimSlot = await provider.connection.getSlot();

    const rewardAccountInfo = await getAccount(
      provider.connection,
      userRewardAccount.address
    );

    const withdrawnAmount = Number(rewardAccountInfo.amount);

    console.log("\n💰 Reward withdrawal:");
    console.log("   Withdrawn:", withdrawnAmount / 1_000_000, "reward tokens");

    // Allow for additional rewards accrued during transaction execution
    // Withdrawn amount should be >= pending reward (more rewards accrue during tx)
    expect(withdrawnAmount).to.be.at.least(pendingRewardBefore);
    // But not significantly more (within 5% tolerance)
    const tolerance = Math.max(
      pendingRewardBefore * REWARD_CALCULATION_TOLERANCE,
      1000
    );
    expect(withdrawnAmount).to.be.within(
      pendingRewardBefore,
      pendingRewardBefore + tolerance
    );

    // After withdrawal, pending rewards should be reset (or very small due to time elapsed)
    const userStakeInfoAfter = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    // Pending rewards should be near zero (may have tiny amount from slots during verification)
    expect(userStakeInfoAfter.pendingReward.toNumber()).to.be.lessThan(1000);
  });

  it("4. 📉 User unstakes 50% (50,000 tokens) after first period", async () => {
    const unstakeAmount = new anchor.BN(50_000_000_000); // 50,000 tokens with 6 decimals

    await program.methods
      .withdrawStake(poolId, unstakeAmount)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenMint: tokenMint,
        rewardMint: rewardMint,
      })
      .signers([user])
      .rpc();

    // Update tracking after unstake (rewards may have been claimed)
    lastRewardClaimSlot = await provider.connection.getSlot();

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const remainingStake = userStakeInfo.amount.toNumber();

    console.log("\n📉 Partial unstaking:");
    console.log(
      "   Unstaked amount:",
      unstakeAmount.toNumber() / 1_000_000,
      "tokens"
    );
    console.log("   Remaining stake:", remainingStake / 1_000_000, "tokens");

    expect(remainingStake).to.equal(50_000_000_000);
  });

  it("5. ⏰ Check rewards after second period (50 more slots with 50,000 tokens)", async () => {
    // Advance 50 more slots (cumulative)
    currentTargetSlot += TEST_SECOND_PERIOD;
    console.log("\n⏰ Advancing to slot", currentTargetSlot, "...");
    await advanceToSlot(provider, currentTargetSlot);

    const currentSlot = await provider.connection.getSlot();
    const slotsElapsed = currentSlot - lastRewardClaimSlot;

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingReward = userStakeInfo.pendingReward.toNumber();
    const pendingRewardTokens = pendingReward / 1_000_000;

    console.log("\n📊 After second period:");
    console.log("   Current slot:", currentSlot);
    console.log("   Slots elapsed since last claim:", slotsElapsed);
    console.log(
      "   Staked amount:",
      userStakeInfo.amount.toNumber() / 1_000_000,
      "tokens"
    );
    console.log("   Pending reward:", pendingRewardTokens, "tokens");

    // Calculate expected reward based on actual slots elapsed (with 50,000 tokens now)
    // reward = amount * rate * slots_elapsed / SLOTS_PER_YEAR / 10000
    const expectedReward = Math.floor(
      (50_000_000_000 * 950 * slotsElapsed) / SLOTS_PER_YEAR / 10000
    );
    const tolerance = Math.max(
      expectedReward * REWARD_CALCULATION_TOLERANCE,
      1000
    );

    console.log(
      "   Expected reward: ~",
      expectedReward / 1_000_000,
      "tokens (with 5% tolerance)"
    );

    expect(pendingReward).to.be.greaterThan(0);
    expect(pendingReward).to.be.within(
      expectedReward - tolerance,
      expectedReward + tolerance
    );
  });

  it("6. 💸 User withdraws rewards after second period", async () => {
    const userStakeInfoBefore = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingRewardBefore = userStakeInfoBefore.pendingReward.toNumber();

    // Withdraw 0 tokens to claim rewards only
    await program.methods
      .withdrawStake(poolId, new anchor.BN(0))
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenMint: tokenMint,
        rewardMint: rewardMint,
      })
      .signers([user])
      .rpc();

    // Update last reward claim slot
    lastRewardClaimSlot = await provider.connection.getSlot();

    const rewardAccountInfo = await getAccount(
      provider.connection,
      userRewardAccount.address
    );

    // Get cumulative rewards (including previous withdrawal)
    const totalRewards = Number(rewardAccountInfo.amount);

    console.log("\n💰 Reward withdrawal after second period:");
    console.log(
      "   This withdrawal:",
      pendingRewardBefore / 1_000_000,
      "reward tokens"
    );
    console.log(
      "   Total rewards so far:",
      totalRewards / 1_000_000,
      "reward tokens"
    );
  });

  it("7. ⏰ Check rewards after third period (100 more slots with 50,000 tokens)", async () => {
    // Advance 100 more slots (cumulative)
    currentTargetSlot += TEST_THIRD_PERIOD;
    console.log("\n⏰ Advancing to slot", currentTargetSlot, "...");
    await advanceToSlot(provider, currentTargetSlot);

    const currentSlot = await provider.connection.getSlot();
    const slotsElapsed = currentSlot - lastRewardClaimSlot;

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingReward = userStakeInfo.pendingReward.toNumber();
    const pendingRewardTokens = pendingReward / 1_000_000;

    console.log("\n📊 After third period:");
    console.log("   Current slot:", currentSlot);
    console.log("   Slots elapsed since last claim:", slotsElapsed);
    console.log(
      "   Staked amount:",
      userStakeInfo.amount.toNumber() / 1_000_000,
      "tokens"
    );
    console.log("   Pending reward:", pendingRewardTokens, "tokens");

    // Calculate expected reward based on actual slots elapsed
    // reward = amount * rate * slots_elapsed / SLOTS_PER_YEAR / 10000
    const expectedReward = Math.floor(
      (50_000_000_000 * 950 * slotsElapsed) / SLOTS_PER_YEAR / 10000
    );
    const tolerance = Math.max(
      expectedReward * REWARD_CALCULATION_TOLERANCE,
      1000
    );

    console.log(
      "   Expected reward: ~",
      expectedReward / 1_000_000,
      "tokens (with 5% tolerance)"
    );

    expect(pendingReward).to.be.greaterThan(0);
    expect(pendingReward).to.be.within(
      expectedReward - tolerance,
      expectedReward + tolerance
    );
  });

  it("8. 💸 Final reward withdrawal and summary", async () => {
    const userStakeInfoBefore = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingRewardBefore = userStakeInfoBefore.pendingReward.toNumber();

    // Withdraw 0 tokens to claim rewards only
    await program.methods
      .withdrawStake(poolId, new anchor.BN(0))
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenMint: tokenMint,
        rewardMint: rewardMint,
      })
      .signers([user])
      .rpc();

    const rewardAccountInfo = await getAccount(
      provider.connection,
      userRewardAccount.address
    );

    const totalRewards = Number(rewardAccountInfo.amount);

    console.log("\n💰 Final reward withdrawal:");
    console.log(
      "   This withdrawal:",
      pendingRewardBefore / 1_000_000,
      "reward tokens"
    );
    console.log(
      "   Total rewards earned:",
      totalRewards / 1_000_000,
      "reward tokens"
    );

    console.log("\n📝 Summary:");
    console.log("   Staking scenario:");
    console.log("     - 100,000 tokens staked initially");
    console.log("     - 50,000 tokens unstaked after first period");
    console.log("     - 50,000 tokens remained staked for remaining periods");
    console.log("   Total rewards earned:", totalRewards / 1_000_000, "tokens");

    // Just verify we received some rewards
    expect(totalRewards).to.be.greaterThan(0);
  });
});
