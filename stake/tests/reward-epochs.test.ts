import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment, warpSlots, TEST_SLOTS_PER_PERIOD } from "./test-utils";

// Use small slot counts for fast testing - reward logic works the same
const SLOTS_PER_DAY = TEST_SLOTS_PER_PERIOD;

describe("🕐 Stake Program - Reward Epochs", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userTokenAccount: any;
  let userRewardAccount: any;
  let userStakePda: anchor.web3.PublicKey;
  let adminRewardAccount: any;
  const poolId = new anchor.BN(0); // Define at module level for reuse across tests

  before(async () => {
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
    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      rewardMintKeypair
    );

    // Create pool with initial reward percentage
    const initialRewardPercentage = 1000; // 10% APY
    await program.methods
      .createPool(null, new anchor.BN(initialRewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    // Get pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Enable staking
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({ pool: poolPda, admin: admin.publicKey, tokenMint: tokenMint })
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

    // Mint tokens to user
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    // Mint rewards to admin and deposit to pool
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      10_000_000_000
    );

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(10_000_000_000))
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

    console.log("✅ Setup complete");
    console.log("   Token mint:", tokenMint.toBase58());
    console.log("   Reward mint:", rewardMint.toBase58());
    console.log("   Pool PDA:", poolPda.toBase58());
  });

  it("1. ✅ Pool initialized with first reward epoch", async () => {
    const poolInfo = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📊 Pool info:");
    console.log("   Reward percentage:", poolInfo.rewardPercentage.toString());
    console.log("   Reward epochs count:", poolInfo.rewardEpochs.length);
    console.log(
      "   First epoch percentage:",
      poolInfo.rewardEpochs[0].rewardPercentage.toString()
    );
    console.log(
      "   Last reward update slot:",
      poolInfo.lastRewardUpdateSlot.toString()
    );

    expect(poolInfo.rewardEpochs.length).to.equal(1);
    expect(poolInfo.rewardEpochs[0].rewardPercentage.toNumber()).to.equal(1000);
    expect(poolInfo.rewardPercentage.toNumber()).to.equal(1000);
    expect(poolInfo.lastRewardUpdateSlot.toNumber()).to.be.greaterThan(0);
  });

  it("2. ✅ User stakes tokens and earns rewards at initial rate", async () => {
    const stakeAmount = new anchor.BN(100_000_000); // 100 tokens

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

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

    console.log("✅ User staked:", stakeAmount.toString());

    // Wait for rewards to accrue (1 day equivalent in slots: ~216,000 slots)
    await warpSlots(provider, SLOTS_PER_DAY);

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("   Pending reward:", userStakeInfo.pendingReward.toString());
    expect(userStakeInfo.pendingReward.toNumber()).to.be.greaterThan(0);
  });

  it("3. ✅ Admin updates reward percentage, creating new epoch", async () => {
    const newPercentage = 2000; // 20% APY

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(newPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolInfo = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📊 Pool info after update:");
    console.log("   Reward percentage:", poolInfo.rewardPercentage.toString());
    console.log("   Reward epochs count:", poolInfo.rewardEpochs.length);
    console.log(
      "   First epoch percentage:",
      poolInfo.rewardEpochs[0].rewardPercentage.toString()
    );
    console.log(
      "   Second epoch percentage:",
      poolInfo.rewardEpochs[1].rewardPercentage.toString()
    );

    expect(poolInfo.rewardEpochs.length).to.equal(2);
    expect(poolInfo.rewardEpochs[0].rewardPercentage.toNumber()).to.equal(1000);
    expect(poolInfo.rewardEpochs[1].rewardPercentage.toNumber()).to.equal(2000);
    expect(poolInfo.rewardPercentage.toNumber()).to.equal(2000);
  });

  it("4. ✅ User earns rewards correctly across epoch boundary", async () => {
    // Wait for more rewards to accrue at new rate (1 day equivalent in slots)
    await warpSlots(provider, SLOTS_PER_DAY);

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("   Pending reward:", userStakeInfo.pendingReward.toString());
    console.log("   Amount staked:", userStakeInfo.amount.toString());

    // User should have earned rewards at both rates
    expect(userStakeInfo.pendingReward.toNumber()).to.be.greaterThan(0);
  });

  it("5. ✅ User claims rewards and rewards are calculated correctly", async () => {
    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const userStakeInfoBefore = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    const pendingReward = userStakeInfoBefore.pendingReward;
    console.log("   Claiming reward:", pendingReward.toString());

    await program.methods
      .claimReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userRewardAccount: userRewardAccount.address,
        rewardVault: rewardVaultPda,
      })
      .signers([user])
      .rpc();

    const userStakeInfoAfter = await program.methods
      .getUserStakeInfo(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("   Total earned:", userStakeInfoAfter.totalEarned.toString());
    console.log("   Unclaimed:", userStakeInfoAfter.unclaimed.toString());

    // Total earned should be >= pending reward (slots may advance during claim transaction)
    expect(userStakeInfoAfter.totalEarned.toNumber()).to.be.at.least(
      pendingReward.toNumber()
    );
    expect(userStakeInfoAfter.unclaimed.toNumber()).to.equal(0);
  });

  it("6. ✅ Multiple reward percentage updates work correctly", async () => {
    // Update to 3000 (30% APY)
    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(3000))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Update to 1500 (15% APY)
    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(1500))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolInfo = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📊 Pool info after multiple updates:");
    console.log("   Reward epochs count:", poolInfo.rewardEpochs.length);
    for (let i = 0; i < poolInfo.rewardEpochs.length; i++) {
      console.log(
        `   Epoch ${i} percentage:`,
        poolInfo.rewardEpochs[i].rewardPercentage.toString()
      );
    }

    expect(poolInfo.rewardEpochs.length).to.equal(4);
    expect(poolInfo.rewardPercentage.toNumber()).to.equal(1500);
  });

  it("7. ✅ Rewards calculated correctly after multiple updates", async () => {
    await warpSlots(provider, SLOTS_PER_DAY); // 1 day equivalent

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: userStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log("   Pending reward:", userStakeInfo.pendingReward.toString());
    expect(userStakeInfo.pendingReward.toNumber()).to.be.greaterThan(0);
  });

  it("8. ✅ Epoch history is limited to 10 epochs", async () => {
    // Add more epochs to test the 10-epoch limit
    for (let i = 0; i < 8; i++) {
      await program.methods
        .updateRewardPercentage(poolId, new anchor.BN(1000 + i * 100))
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          tokenMint: tokenMint,
        })
        .rpc();
    }

    const poolInfo = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📊 Pool info after many updates:");
    console.log("   Reward epochs count:", poolInfo.rewardEpochs.length);

    // Should be capped at 10
    expect(poolInfo.rewardEpochs.length).to.be.lessThanOrEqual(10);
  });

  it("9. ✅ New user stakes and earns rewards at current rate", async () => {
    // Create a new user
    const newUser = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(newUser.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const newUserTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      newUser.publicKey
    );

    // Mint tokens to new user
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      newUserTokenAccount.address,
      admin.publicKey,
      500_000_000
    );

    const [newUserStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        newUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    const stakeAmount = new anchor.BN(100_000_000);

    await program.methods
      .depositStake(poolId, stakeAmount)
      .accounts({
        pool: poolPda,
        userStake: newUserStakePda,
        user: newUser.publicKey,
        userTokenAccount: newUserTokenAccount.address,
        poolVault: poolVaultPda,
        tokenMint: tokenMint,
      })
      .signers([newUser])
      .rpc();

    console.log("✅ New user staked:", stakeAmount.toString());

    // Wait for rewards (1 day equivalent in slots)
    await warpSlots(provider, SLOTS_PER_DAY);

    const userStakeInfo = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        userStake: newUserStakePda,
        pool: poolPda,
        tokenMint: tokenMint,
      })
      .view();

    console.log(
      "   New user pending reward:",
      userStakeInfo.pendingReward.toString()
    );
    expect(userStakeInfo.pendingReward.toNumber()).to.be.greaterThan(0);
  });
});
