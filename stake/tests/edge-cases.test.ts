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

describe("🧪 Stake Program - Edge Cases", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
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
      tokenMintKeypair
    );

    // Create a token mint for rewards
    // Same-token enforcement: reward mint must equal staking token mint
    rewardMint = tokenMint;

    const tokenInfo = await getMint(provider.connection, tokenMint);

    expect(tokenInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );

    // Create pool for edge case tests
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

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mint = token mint (same-token):", rewardMint.toBase58());
  });

  it("✅ Admin can deposit reward even when pool is disabled", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // First, disable the pool
    await program.methods
      .setStakingActive(poolId, false)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.isActive).to.equal(false);
    console.log("🔒 Pool disabled successfully");

    // Prepare deposit amount
    const DEPOSIT_AMOUNT = 100_000_000; // 100 tokens

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolAccount.rewardMint,
      admin.publicKey
    );

    // Mint tokens to admin
    await mintTo(
      provider.connection,
      admin.payer,
      poolAccount.rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    // Admin should be able to deposit even while pool is disabled
    await program.methods
      .depositReward(poolId, new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    console.log(
      "✅ Admin successfully deposited rewards while pool is disabled"
    );
  });

  it("✅ User can withdraw stake even when admin drains reward vault (rewards saved as unclaimed)", async () => {
    console.log("\n================= 🧪 ADMIN DRAIN TEST =================\n");

    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Re-enable the pool first
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Setup: Create a new user for this test
    const testUser = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testUser.publicKey,
      2e9
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        testUser.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    // Get pool info to find reward vault
    const poolInfo = await program.account.pool.fetch(poolPda);
    const rewardVaultPda = poolInfo.rewardVault;

    // Create token accounts for test user
    const testUserTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      testUser,
      tokenMint,
      testUser.publicKey
    );
    const testUserRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      testUser,
      poolInfo.rewardMint,
      testUser.publicKey
    );

    // Mint tokens to test user
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      testUserTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT
    );

    console.log("✅ Test user created and funded");

    // Deposit some rewards into the vault
    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolInfo.rewardMint,
      admin.publicKey
    );

    const REWARD_DEPOSIT = 1_000_000_000; // 1000 tokens
    await mintTo(
      provider.connection,
      admin.payer,
      poolInfo.rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      REWARD_DEPOSIT
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(REWARD_DEPOSIT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    console.log("✅ Reward vault funded");

    // 1. User stakes tokens
    const STAKE_AMOUNT = new anchor.BN(500_000_000);
    console.log("\n🔹 User staking:", STAKE_AMOUNT.toString());

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

    console.log("✅ User staked successfully");

    // 2. Wait for some time to accrue rewards
    console.log("\n⏳ Advancing blockchain by 1 day equivalent...");
    await warpSlots(provider, SLOTS_PER_DAY);

    // Check pending rewards before admin drain
    const userStakeInfoBeforeDrain = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        tokenMint: tokenMint,
      })
      .view();

    console.log(
      "Pending rewards before admin drain:",
      Number(userStakeInfoBeforeDrain.pendingReward)
    );
    expect(Number(userStakeInfoBeforeDrain.pendingReward)).to.be.greaterThan(0);

    // 3. Admin drains the entire reward vault
    const rewardVaultBefore = await getAccount(
      provider.connection,
      rewardVaultPda
    );
    const rewardVaultBalance = Number(rewardVaultBefore.amount);
    console.log(
      "\n💸 Admin draining reward vault. Balance:",
      rewardVaultBalance
    );

    await program.methods
      .withdrawReward(poolId, new anchor.BN(rewardVaultBalance))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    const rewardVaultAfterDrain = await getAccount(
      provider.connection,
      rewardVaultPda
    );
    console.log(
      "Reward vault after admin drain:",
      Number(rewardVaultAfterDrain.amount)
    );
    expect(Number(rewardVaultAfterDrain.amount)).to.equal(0);

    // 4. User attempts to withdraw stake (should succeed even though reward vault is empty)
    console.log("\n🔹 User withdrawing stake with empty reward vault...");

    const userTokenBalanceBefore = await getAccount(
      provider.connection,
      testUserTokenAccount.address
    );
    const userStakeBeforeWithdraw = await program.account.userStake.fetch(
      userStakePda
    );

    await program.methods
      .withdrawStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: poolPda,
        user: testUser.publicKey,
        userStake: userStakePda,
        userTokenAccount: testUserTokenAccount.address,
        userRewardAccount: testUserRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([testUser])
      .rpc();

    console.log(
      "✅ User successfully withdrew stake despite empty reward vault!"
    );

    // 5. Verify the results
    const userTokenBalanceAfter = await getAccount(
      provider.connection,
      testUserTokenAccount.address
    );
    const userStakeAfterWithdraw = await program.account.userStake.fetch(
      userStakePda
    );
    const userRewardBalanceAfter = await getAccount(
      provider.connection,
      testUserRewardAccount.address
    );

    console.log("\n======== RESULTS AFTER WITHDRAW ========");
    console.log(
      "User token balance increased by:",
      Number(userTokenBalanceAfter.amount) -
        Number(userTokenBalanceBefore.amount)
    );
    console.log("User stake amount:", Number(userStakeAfterWithdraw.amount));
    console.log(
      "User unclaimed rewards:",
      Number(userStakeAfterWithdraw.unclaimed)
    );
    console.log(
      "User reward balance (should be 0):",
      Number(userRewardBalanceAfter.amount)
    );

    // Assertions
    expect(Number(userTokenBalanceAfter.amount)).to.equal(MINT_AMOUNT); // Got stake back
    expect(Number(userStakeAfterWithdraw.amount)).to.equal(0); // Fully withdrawn
    expect(Number(userStakeAfterWithdraw.unclaimed)).to.be.greaterThan(0); // Rewards saved as unclaimed
    // Note: with same-token enforcement, reward account == token account,
    // so we can't assert reward balance = 0 separately. The key assertion
    // is that unclaimed > 0, meaning rewards were NOT paid from the empty vault.

    console.log(
      "\n✅ SUCCESS: User can withdraw stake even when reward vault is empty"
    );
    console.log(
      `   Rewards (${userStakeAfterWithdraw.unclaimed}) saved as unclaimed for later`
    );

    // 6. Admin deposits rewards again
    console.log("\n💰 Admin depositing rewards back...");
    const REFILL_AMOUNT = 200_000_000;

    await mintTo(
      provider.connection,
      admin.payer,
      poolInfo.rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      REFILL_AMOUNT
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(REFILL_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    console.log("✅ Admin refilled reward vault");

    // 7. User claims their unclaimed rewards
    if (Number(userStakeAfterWithdraw.unclaimed) > 0) {
      console.log("\n🎁 User claiming unclaimed rewards...");

      // First, user needs to stake again to be able to claim
      await mintTo(
        provider.connection,
        admin.payer,
        tokenMint,
        testUserTokenAccount.address,
        admin.publicKey,
        STAKE_AMOUNT.toNumber()
      );

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

      await program.methods
        .claimReward(poolId)
        .accounts({
          pool: poolPda,
          tokenMint: tokenMint,
          user: testUser.publicKey,
          userStake: userStakePda,
          userRewardAccount: testUserRewardAccount.address,
          rewardVault: rewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      const finalRewardBalance = await getAccount(
        provider.connection,
        testUserRewardAccount.address
      );
      const finalUserStake = await program.account.userStake.fetch(
        userStakePda
      );

      console.log(
        "✅ User claimed rewards:",
        Number(finalRewardBalance.amount)
      );
      console.log("   Remaining unclaimed:", Number(finalUserStake.unclaimed));

      expect(Number(finalRewardBalance.amount)).to.be.greaterThan(0);
    }

    console.log("\n🎉 Test complete: Admin drain protection works correctly!");
  });

  it("❌ User cannot claim reward when pool is disabled", async () => {
    console.log("\n================= 🧪 CLAIM REWARD DISABLED TEST =================\n");

    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Setup: Create a new user for this test
    const testUser = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(
      testUser.publicKey,
      2e9
    );
    await provider.connection.confirmTransaction(airdropSig);

    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        testUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);

    // Re-enable pool first to allow staking
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Create user token accounts
    const testUserTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      testUser.publicKey
    );

    const testUserRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolAccount.rewardMint,
      testUser.publicKey
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("reward_vault"),
        poolPda.toBuffer(),
        poolAccount.rewardMint.toBuffer(),
      ],
      program.programId
    );

    // Mint and stake tokens
    const STAKE_AMOUNT = new anchor.BN(1_000_000);
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      testUserTokenAccount.address,
      admin.publicKey,
      STAKE_AMOUNT.toNumber()
    );

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

    console.log("✅ User staked tokens successfully");

    // Wait to accumulate some rewards using deterministic slot advancement
    await warpSlots(provider, 25); // ~10 seconds equivalent

    // Now disable the pool
    await program.methods
      .setStakingActive(poolId, false)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    console.log("🔒 Pool disabled successfully");

    // Try to claim rewards - should fail
    try {
      await program.methods
        .claimReward(poolId)
        .accounts({
          pool: poolPda,
          tokenMint: tokenMint,
          user: testUser.publicKey,
          userStake: userStakePda,
          userRewardAccount: testUserRewardAccount.address,
          rewardVault: rewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();

      throw new Error("Claim succeeded while pool is disabled");
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log("✅ Expected error caught:", errMsg);
      expect(errMsg).to.include("Staking is currently disabled");
    }

    console.log(
      "\n🎉 Test complete: claim_reward correctly blocked when pool is disabled!"
    );
  });
});
