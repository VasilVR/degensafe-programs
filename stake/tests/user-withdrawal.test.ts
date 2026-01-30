import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment, warpSlots, TEST_SLOTS_PER_PERIOD , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

// Use small slot counts for fast testing - reward logic works the same
const SLOTS_PER_DAY = TEST_SLOTS_PER_PERIOD;
const SLOTS_PER_HOUR = Math.floor(TEST_SLOTS_PER_PERIOD / 24);

describe("💸 Stake Program - User Withdrawal", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userTokenAccount: any;
  const poolId = new anchor.BN(0); // Define at module level for reuse across tests

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    // Create a token mint for staking
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      tokenMintKeypair,
    );

    // Create a token mint for rewards
    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      rewardMintKeypair,
    );

    const tokenInfo = await getMint(provider.connection, tokenMint);
    const rewardInfo = await getMint(provider.connection, rewardMint);

    expect(tokenInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58(),
    );
    expect(rewardInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58(),
    );

    // Create pool for user withdrawal tests
    const rewardPercentage = 2500; // 25.00% APY in basis points
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Ensure pool is active
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({ pool: poolPda, admin: admin.publicKey, tokenMint: tokenMint })
      .rpc();

    // Deposit some rewards into the vault
    const poolAccount = await program.account.pool.fetch(poolPda);
    const rewardVaultPda = poolAccount.rewardVault;

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey,
    );

    const DEPOSIT_AMOUNT = 1_000_000_000; // 1000 tokens (6 decimals)
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      DEPOSIT_AMOUNT,
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    // Setup user
    user = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000);

    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      user.publicKey,
    );

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mint created:", rewardMint.toBase58());
    console.log("✅ Reward vault funded with:", DEPOSIT_AMOUNT);
  });

  it("User can deposit then withdraw part of their staked amount (partial withdraw) with time warp and pending rewards check", async () => {
    console.log(
      "\n================= 🧪 PARTIAL WITHDRAW TEST =================\n",
    );

    // -------------------------
    // PDAs
    // -------------------------
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId,
    );
    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId,
    );

    // -------------------------
    // 1) Mint initial tokens
    // -------------------------
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT,
    );

    const userBeforeMint = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    console.log(
      "User token balance BEFORE stake:",
      Number(userBeforeMint.amount),
    );

    // -------------------------
    // 2) Deposit / Stake
    // -------------------------
    const DEPOSIT_AMOUNT = new anchor.BN(800_000_000);
    console.log("\n🔹 Depositing:", DEPOSIT_AMOUNT.toString());

    await program.methods
      .depositStake(poolId, DEPOSIT_AMOUNT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    const userAfterDeposit = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    const vaultAfterDeposit = await getAccount(
      provider.connection,
      poolVaultPda,
    );
    const userStakeAfterDeposit =
      await program.account.userStake.fetch(userStakePda);
    const poolAfterDeposit = await program.account.pool.fetch(poolPda);

    console.log("\n======== STAKE INFO AFTER DEPOSIT ========");
    console.log("User balance AFTER deposit:", Number(userAfterDeposit.amount));
    console.log(
      "Vault balance AFTER deposit:",
      Number(vaultAfterDeposit.amount),
    );
    console.log("UserStake.amount:", userStakeAfterDeposit.amount.toString());
    console.log(
      "UserStake.unclaimed:",
      userStakeAfterDeposit.unclaimed.toString(),
    );
    console.log("Pool.total_staked:", poolAfterDeposit.totalStaked.toString());

    const userStakeInfo1 = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();

    console.log(
      "Pending reward AFTER deposit:",
      Number(userStakeInfo1.pendingReward),
    );

    // -------------------------
    // 3) Warp 1 day
    // -------------------------
    console.log("\n⏳ Advancing blockchain by 1 day equivalent...");
    await warpSlots(provider, SLOTS_PER_DAY);

    // -------------------------
    // 4) Withdraw 50%
    // -------------------------
    const WITHDRAW_AMOUNT = new anchor.BN(400_000_000);
    console.log("\n🔹 Withdrawing 50% of stake:", WITHDRAW_AMOUNT.toString());

    const poolBeforeWithdraw = await program.account.pool.fetch(poolPda);
    const userStakeBeforeWithdraw =
      await program.account.userStake.fetch(userStakePda);
    const userBeforeWithdraw = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    const vaultBeforeWithdraw = await getAccount(
      provider.connection,
      poolVaultPda,
    );
    const userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      poolBeforeWithdraw.rewardMint,
      user.publicKey,
    );
    const userRewardBefore = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );

    console.log("\n======== STAKE INFO BEFORE WITHDRAW ========");
    console.log("UserStake.amount:", userStakeBeforeWithdraw.amount.toString());
    console.log(
      "UserStake.unclaimed:",
      userStakeBeforeWithdraw.unclaimed.toString(),
    );
    console.log(
      "Pool.total_staked:",
      poolBeforeWithdraw.totalStaked.toString(),
    );
    console.log(
      "User balance BEFORE withdraw:",
      Number(userBeforeWithdraw.amount),
    );
    console.log(
      "Vault balance BEFORE withdraw:",
      Number(vaultBeforeWithdraw.amount),
    );
    console.log(
      "User reward balance BEFORE withdraw:",
      Number(userRewardBefore.amount),
    );

    const userStakeInfoBeforeWithdraw = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();
    console.log(
      "Pending reward BEFORE withdraw:",
      Number(userStakeInfoBeforeWithdraw.pendingReward),
    );

    await program.methods
      .withdrawStake(poolId, WITHDRAW_AMOUNT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolBeforeWithdraw.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    const userAfterWithdraw = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    const vaultAfterWithdraw = await getAccount(
      provider.connection,
      poolVaultPda,
    );
    const userStakeAfterWithdraw =
      await program.account.userStake.fetch(userStakePda);
    const poolAfterWithdraw = await program.account.pool.fetch(poolPda);
    const userRewardAfter = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );

    console.log("\n======== STAKE INFO AFTER WITHDRAW ========");
    console.log(
      "User balance AFTER withdraw:",
      Number(userAfterWithdraw.amount),
    );
    console.log(
      "Vault balance AFTER withdraw:",
      Number(vaultAfterWithdraw.amount),
    );
    console.log("UserStake.amount:", userStakeAfterWithdraw.amount.toString());
    console.log(
      "UserStake.unclaimed:",
      userStakeAfterWithdraw.unclaimed.toString(),
    );
    console.log("Pool.total_staked:", poolAfterWithdraw.totalStaked.toString());
    console.log(
      "User reward balance AFTER withdraw:",
      Number(userRewardAfter.amount),
    );

    const userStakeInfoAfterWithdraw = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();
    console.log(
      "Pending reward AFTER withdraw:",
      Number(userStakeInfoAfterWithdraw.pendingReward),
    );

    const rewardReceived =
      Number(userRewardAfter.amount) - Number(userRewardBefore.amount);
    console.log("Reward tokens received from withdraw:", rewardReceived);

    // -------------------------
    // 5) Warp 2 more days
    // -------------------------
    console.log("\n⏳ Advancing blockchain by 2 days equivalent...");
    await warpSlots(provider, 2 * SLOTS_PER_DAY);

    // -------------------------
    // 6) Withdraw remaining stake
    // -------------------------
    const remainingStake = new anchor.BN(
      userStakeAfterWithdraw.amount.toString(),
    );
    console.log("\n🔹 Withdrawing remaining stake:", remainingStake.toString());

    const userRewardBefore2 = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );
    const userBeforeWithdraw2 = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    const vaultBeforeWithdraw2 = await getAccount(
      provider.connection,
      poolVaultPda,
    );
    const userStakeBeforeWithdraw2 =
      await program.account.userStake.fetch(userStakePda);
    const poolBeforeWithdraw2 = await program.account.pool.fetch(poolPda);

    const userStakeInfoBeforeFinalWithdraw = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();
    console.log(
      "Pending reward BEFORE final withdraw:",
      Number(userStakeInfoBeforeFinalWithdraw.pendingReward),
    );

    await program.methods
      .withdrawStake(poolId, remainingStake)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolBeforeWithdraw2.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    const userAfterWithdraw2 = await getAccount(
      provider.connection,
      userTokenAccount.address,
    );
    const vaultAfterWithdraw2 = await getAccount(
      provider.connection,
      poolVaultPda,
    );
    const userStakeAfterWithdraw2 =
      await program.account.userStake.fetch(userStakePda);
    const poolAfterWithdraw2 = await program.account.pool.fetch(poolPda);
    const userRewardAfter2 = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );

    const userStakeInfoAfterFinalWithdraw = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("\n======== STAKE INFO AFTER FINAL WITHDRAW ========");
    console.log(
      "User balance AFTER withdraw:",
      Number(userAfterWithdraw2.amount),
    );
    console.log(
      "Vault balance AFTER withdraw:",
      Number(vaultAfterWithdraw2.amount),
    );
    console.log("UserStake.amount:", userStakeAfterWithdraw2.amount.toString());
    console.log(
      "UserStake.unclaimed:",
      userStakeAfterWithdraw2.unclaimed.toString(),
    );
    console.log(
      "Pool.total_staked:",
      poolAfterWithdraw2.totalStaked.toString(),
    );
    console.log(
      "User reward balance AFTER withdraw:",
      Number(userRewardAfter2.amount),
    );
    console.log(
      "Pending reward AFTER final withdraw:",
      Number(userStakeInfoAfterFinalWithdraw.pendingReward),
    );

    // -------------------------
    // 7) Warp 2 hours after 0 stake
    // -------------------------
    console.log(
      "\n⏳ Advancing blockchain by 2 hours equivalent to check rewards with 0 stake...",
    );
    await warpSlots(provider, 2 * SLOTS_PER_HOUR);

    const userStakeInfoAfter2h = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();

    console.log(
      "Pending reward 2 hours after 0 stake:",
      Number(userStakeInfoAfter2h.pendingReward),
    );
  });

  it("User can claim rewards without unstaking by calling withdraw_stake(0)", async () => {
    console.log(
      "\n================= 🧪 CLAIM REWARDS WITHOUT UNSTAKING TEST =================\n",
    );

    // -------------------------
    // Setup: Create a new user for this test
    // -------------------------
    const testUser = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(testUser.publicKey, 2_000_000_000);

    const testUserTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      testUser.publicKey,
    );

    // -------------------------
    // PDAs
    // -------------------------
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        testUser.publicKey.toBuffer(),
      ],
      program.programId,
    );
    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId,
    );

    // -------------------------
    // 1) Mint tokens to test user
    // -------------------------
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      testUserTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT,
    );

    console.log("Test user token balance:", MINT_AMOUNT);

    // -------------------------
    // 2) Stake tokens
    // -------------------------
    const STAKE_AMOUNT = new anchor.BN(500_000_000);
    console.log("\n🔹 Staking:", STAKE_AMOUNT.toString());

    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: poolPda,
        user: testUser.publicKey,
        userStake: userStakePda,
        userTokenAccount: testUserTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([testUser])
      .rpc();

    const userStakeAfterDeposit =
      await program.account.userStake.fetch(userStakePda);
    const userTokenAfterStake = await getAccount(
      provider.connection,
      testUserTokenAccount.address,
    );

    console.log("\n======== AFTER STAKING ========");
    console.log("User staked amount:", userStakeAfterDeposit.amount.toString());
    console.log("User token balance:", Number(userTokenAfterStake.amount));
    expect(userStakeAfterDeposit.amount.toString()).to.equal(
      STAKE_AMOUNT.toString(),
    );

    // -------------------------
    // 3) Warp time to accumulate rewards
    // -------------------------
    console.log("\n⏳ Advancing blockchain by 1 day equivalent to accumulate rewards...");
    await warpSlots(provider, SLOTS_PER_DAY);

    // -------------------------
    // 4) Check pending rewards before withdrawal
    // -------------------------
    const userStakeInfoBeforeWithdraw = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingReward = Number(userStakeInfoBeforeWithdraw.pendingReward);
    console.log("\n======== BEFORE WITHDRAW(0) ========");
    console.log("Pending rewards:", pendingReward);
    expect(pendingReward).to.be.greaterThan(0);

    // -------------------------
    // 5) Get user's reward account
    // -------------------------
    const poolAccount = await program.account.pool.fetch(poolPda);
    const userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      testUser,
      poolAccount.rewardMint,
      testUser.publicKey,
    );

    const userRewardBefore = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );
    const userStakeBeforeWithdraw =
      await program.account.userStake.fetch(userStakePda);
    const userTokenBeforeWithdraw = await getAccount(
      provider.connection,
      testUserTokenAccount.address,
    );

    console.log("User reward balance before:", Number(userRewardBefore.amount));
    console.log(
      "User staked amount before:",
      userStakeBeforeWithdraw.amount.toString(),
    );
    console.log(
      "User token balance before:",
      Number(userTokenBeforeWithdraw.amount),
    );

    // -------------------------
    // 6) Call withdraw_stake(0) to claim rewards without unstaking
    // -------------------------
    console.log("\n🔹 Calling withdraw_stake(0) to claim rewards...");

    await program.methods
      .withdrawStake(poolId, new anchor.BN(0)) // amount = 0
      .accounts({
        pool: poolPda,
        tokenMint: tokenMint,
        user: testUser.publicKey,
        userStake: userStakePda,
        userTokenAccount: testUserTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([testUser])
      .rpc();

    // -------------------------
    // 7) Verify results
    // -------------------------
    const userRewardAfter = await getAccount(
      provider.connection,
      userRewardAccount.address,
    );
    const userStakeAfterWithdraw =
      await program.account.userStake.fetch(userStakePda);
    const userTokenAfterWithdraw = await getAccount(
      provider.connection,
      testUserTokenAccount.address,
    );

    const rewardsReceived =
      Number(userRewardAfter.amount) - Number(userRewardBefore.amount);

    console.log("\n======== AFTER WITHDRAW(0) ========");
    console.log("Rewards received:", rewardsReceived);
    console.log("User reward balance after:", Number(userRewardAfter.amount));
    console.log(
      "User staked amount after:",
      userStakeAfterWithdraw.amount.toString(),
    );
    console.log(
      "User token balance after:",
      Number(userTokenAfterWithdraw.amount),
    );

    // Verify rewards were received
    expect(rewardsReceived).to.be.greaterThan(0);
    console.log("✅ Rewards received:", rewardsReceived);

    // Verify staked amount remained unchanged
    expect(userStakeAfterWithdraw.amount.toString()).to.equal(
      userStakeBeforeWithdraw.amount.toString(),
    );
    console.log(
      "✅ Staked amount unchanged:",
      userStakeAfterWithdraw.amount.toString(),
    );

    // Verify token balance (staked tokens) remained unchanged
    expect(Number(userTokenAfterWithdraw.amount)).to.equal(
      Number(userTokenBeforeWithdraw.amount),
    );
    console.log(
      "✅ Token balance unchanged:",
      Number(userTokenAfterWithdraw.amount),
    );

    // Verify unclaimed rewards are now 0 (all claimed)
    expect(userStakeAfterWithdraw.unclaimed.toString()).to.equal("0");
    console.log("✅ Unclaimed rewards cleared");

    console.log(
      "\n✅ TEST PASSED: Successfully claimed rewards without unstaking!",
    );
  });
});
