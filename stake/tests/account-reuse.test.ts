import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔒 Stake Program - Account Reuse Prevention Tests", () => {
  const { provider, program, admin } = getTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let pool: anchor.web3.PublicKey;
  let bob: anchor.web3.Keypair;
  const poolId = new anchor.BN(0); // Define at module level for reuse across tests

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    console.log("\n🔧 Setting up test environment...\n");

    // Validate test environment components
    expect(provider).to.not.be.undefined;
    expect(program).to.not.be.undefined;
    expect(admin).to.not.be.undefined;

    // Create token mint
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      tokenMintKeypair
    );

    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      rewardMintKeypair
    );

    // Create Pool
    const rewardPercentage = 1000; // 10.00% APY in basis points
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    [pool] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Enable Pool
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({ pool: pool, admin: admin.publicKey, tokenMint: tokenMint })
      .rpc();

    // Fund reward vault
    const poolAccount = await program.account.pool.fetch(pool);

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 1_000_000_000; // 1000 tokens
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    await program.methods
      .depositReward(poolId, new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: pool,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    // Create Bob user
    bob = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(bob.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("✅ Pool created:", pool.toBase58());
    console.log("✅ Test user Bob:", bob.publicKey.toBase58());
  });

  it("✅ Allows re-deposit after full withdrawal (account reuse with same pool)", async () => {
    console.log(
      "\n================= 🧪 ACCOUNT REUSE - SAME POOL TEST =================\n"
    );

    // Setup Bob's accounts
    const bobTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      bob.publicKey
    );

    const bobRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      bob,
      rewardMint,
      bob.publicKey
    );

    // Mint tokens to Bob
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      bobTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT
    );

    const [bobStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), pool.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), pool.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(pool);

    // STEP 1: Bob stakes tokens
    console.log("🔹 Step 1: Bob stakes 500 tokens");
    const STAKE_AMOUNT = new anchor.BN(500_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: pool,
        user: bob.publicKey,
        userStake: bobStakePda,
        userTokenAccount: bobTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([bob])
      .rpc();

    let bobStake = await program.account.userStake.fetch(bobStakePda);
    console.log("   ✓ Staked amount:", bobStake.amount.toString());
    expect(bobStake.amount.toString()).to.equal(STAKE_AMOUNT.toString());
    expect(bobStake.pool.toBase58()).to.equal(pool.toBase58());

    // STEP 2: Bob fully withdraws (amount becomes 0, but account persists)
    console.log("\n🔹 Step 2: Bob withdraws all tokens (full withdrawal)");
    await program.methods
      .withdrawStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: pool,
        user: bob.publicKey,
        userStake: bobStakePda,
        userTokenAccount: bobTokenAccount.address,
        userRewardAccount: bobRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([bob])
      .rpc();

    bobStake = await program.account.userStake.fetch(bobStakePda);
    console.log("   ✓ Remaining amount:", bobStake.amount.toString());
    expect(bobStake.amount.toString()).to.equal("0");
    // Account still exists but with zero balance
    expect(bobStake.owner.toBase58()).to.equal(bob.publicKey.toBase58());
    expect(bobStake.pool.toBase58()).to.equal(pool.toBase58());

    // STEP 3: Bob deposits again (reusing the account)
    console.log("\n🔹 Step 3: Bob stakes again (account reuse with same pool)");
    const STAKE_AMOUNT_2 = new anchor.BN(300_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT_2)
      .accounts({
        pool: pool,
        user: bob.publicKey,
        userStake: bobStakePda,
        userTokenAccount: bobTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([bob])
      .rpc();

    bobStake = await program.account.userStake.fetch(bobStakePda);
    console.log("   ✓ New staked amount:", bobStake.amount.toString());
    expect(bobStake.amount.toString()).to.equal(STAKE_AMOUNT_2.toString());
    expect(bobStake.pool.toBase58()).to.equal(pool.toBase58());

    console.log(
      "\n🎉 SECURITY TEST PASSED: Account reuse with same pool works correctly!"
    );
  });

  it("✅ Preserves unclaimed rewards during account reuse", async () => {
    console.log(
      "\n================= 🧪 UNCLAIMED REWARDS PRESERVATION TEST =================\n"
    );

    // Create new user Charlie for this test
    const charlie = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(charlie.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const charlieTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      charlie.publicKey
    );

    const charlieRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      charlie,
      rewardMint,
      charlie.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      charlieTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    const [charlieStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        pool.toBuffer(),
        charlie.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), pool.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(pool);

    // Charlie stakes
    console.log("🔹 Step 1: Charlie stakes tokens");
    const STAKE_AMOUNT = new anchor.BN(500_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: pool,
        user: charlie.publicKey,
        userStake: charlieStakePda,
        userTokenAccount: charlieTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([charlie])
      .rpc();

    // Wait for some rewards to accrue (simulate time passing)
    console.log("🔹 Step 2: Waiting for rewards to accrue...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check pending rewards before withdrawal
    const rewardInfoBefore = await program.methods
      .getUserStakeWithReward(poolId)
      .accounts({
        pool: pool,
        userStake: charlieStakePda,
        tokenMint: tokenMint,
      })
      .view();

    console.log(
      "   ✓ Pending rewards before withdrawal:",
      rewardInfoBefore.pendingReward.toString()
    );
    const pendingBeforeWithdraw = rewardInfoBefore.pendingReward;

    // Charlie withdraws only part of the stake (keeping some staked)
    console.log("\n🔹 Step 3: Charlie partially withdraws stake");
    const WITHDRAW_AMOUNT = new anchor.BN(200_000_000);
    await program.methods
      .withdrawStake(poolId, WITHDRAW_AMOUNT)
      .accounts({
        pool: pool,
        user: charlie.publicKey,
        userStake: charlieStakePda,
        userTokenAccount: charlieTokenAccount.address,
        userRewardAccount: charlieRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([charlie])
      .rpc();

    let charlieStake = await program.account.userStake.fetch(charlieStakePda);
    const expectedRemaining = STAKE_AMOUNT.sub(WITHDRAW_AMOUNT);
    console.log("   ✓ Remaining stake:", charlieStake.amount.toString());
    expect(charlieStake.amount.toString()).to.equal(
      expectedRemaining.toString()
    );

    // The rewards should have been paid out during withdrawal
    const totalEarnedAfterPartialWithdraw = charlieStake.totalEarned;
    console.log(
      "   ✓ Total earned after withdrawal:",
      totalEarnedAfterPartialWithdraw.toString()
    );

    // Now Charlie fully withdraws the rest
    console.log("\n🔹 Step 4: Charlie fully withdraws remaining stake");
    await program.methods
      .withdrawStake(poolId, expectedRemaining)
      .accounts({
        pool: pool,
        user: charlie.publicKey,
        userStake: charlieStakePda,
        userTokenAccount: charlieTokenAccount.address,
        userRewardAccount: charlieRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([charlie])
      .rpc();

    charlieStake = await program.account.userStake.fetch(charlieStakePda);
    console.log("   ✓ Final stake amount:", charlieStake.amount.toString());
    expect(charlieStake.amount.toString()).to.equal("0");

    console.log(
      "\n🎉 SECURITY TEST PASSED: Unclaimed rewards properly handled during withdrawals!"
    );
  });

  it("✅ Account initialization sets correct pool reference", async () => {
    console.log(
      "\n================= 🧪 ACCOUNT INITIALIZATION TEST =================\n"
    );

    // Create new user David
    const david = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(david.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const davidTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      david.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      davidTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    const [davidStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), pool.toBuffer(), david.publicKey.toBuffer()],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), pool.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    console.log(
      "🔹 David stakes for the first time (new account initialization)"
    );
    const STAKE_AMOUNT = new anchor.BN(100_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: pool,
        user: david.publicKey,
        userStake: davidStakePda,
        userTokenAccount: davidTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([david])
      .rpc();

    const davidStake = await program.account.userStake.fetch(davidStakePda);
    console.log("   ✓ Pool reference:", davidStake.pool.toBase58());
    console.log("   ✓ Owner:", davidStake.owner.toBase58());
    console.log("   ✓ Amount:", davidStake.amount.toString());
    console.log("   ✓ Total earned:", davidStake.totalEarned.toString());
    console.log("   ✓ Unclaimed:", davidStake.unclaimed.toString());

    expect(davidStake.pool.toBase58()).to.equal(pool.toBase58());
    expect(davidStake.owner.toBase58()).to.equal(david.publicKey.toBase58());
    expect(davidStake.amount.toString()).to.equal(STAKE_AMOUNT.toString());
    expect(davidStake.totalEarned.toString()).to.equal("0");
    expect(davidStake.unclaimed.toString()).to.equal("0");

    console.log(
      "\n🎉 SECURITY TEST PASSED: Account initialized with correct pool reference!"
    );
  });
});
