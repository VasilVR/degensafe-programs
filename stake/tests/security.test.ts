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
import { getTestEnvironment , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔒 Stake Program - Security Tests", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
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
    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      rewardMintKeypair
    );

    const tokenInfo = await getMint(provider.connection, tokenMint);
    const rewardInfo = await getMint(provider.connection, rewardMint);

    expect(tokenInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );
    expect(rewardInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );

    // Create pool for security tests
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
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
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
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 1_000_000_000; // 1000 tokens (6 decimals)
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
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mint created:", rewardMint.toBase58());
    console.log("✅ Reward vault funded with:", DEPOSIT_AMOUNT);
  });

  it("❌ Unauthorized user cannot withdraw from another user's stake account", async () => {
    console.log(
      "\n================= 🧪 UNAUTHORIZED WITHDRAWAL TEST =================\n"
    );

    // Create two users: Alice (legitimate owner) and Bob (attacker)
    const alice = anchor.web3.Keypair.generate();
    const bob = anchor.web3.Keypair.generate();

    // Airdrop SOL to both users
    await provider.connection.requestAirdrop(alice.publicKey, 2_000_000_000);
    await provider.connection.requestAirdrop(bob.publicKey, 2_000_000_000);

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("👤 Alice (legitimate owner):", alice.publicKey.toBase58());
    console.log("👤 Bob (attacker):", bob.publicKey.toBase58());

    // Setup Alice's accounts
    const aliceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      alice.publicKey
    );

    // PDAs
    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );
    const [aliceStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        alice.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Mint tokens to Alice
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      aliceTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT
    );

    console.log("\n🔹 Alice stakes 500 tokens...");

    // Alice stakes tokens
    const STAKE_AMOUNT = new anchor.BN(500_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: poolPda,
        user: alice.publicKey,
        userStake: aliceStakePda,
        userTokenAccount: aliceTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([alice])
      .rpc();

    // Verify Alice's stake
    const aliceStakeAccount = await program.account.userStake.fetch(
      aliceStakePda
    );
    console.log("✅ Alice staked:", aliceStakeAccount.amount.toString());
    expect(aliceStakeAccount.owner.toBase58()).to.equal(
      alice.publicKey.toBase58()
    );
    expect(aliceStakeAccount.amount.toString()).to.equal(
      STAKE_AMOUNT.toString()
    );

    // Setup Bob's accounts (attacker)
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

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "\n🔹 Bob (attacker) attempts to withdraw from Alice's stake..."
    );

    // Bob tries to withdraw from Alice's stake account
    const WITHDRAW_AMOUNT = new anchor.BN(100_000_000); // Try to withdraw 100 tokens
    try {
      await program.methods
        .withdrawStake(poolId, WITHDRAW_AMOUNT)
        .accounts({
          pool: poolPda,
          user: bob.publicKey, // Bob is the signer
          userStake: aliceStakePda, // But trying to use Alice's stake PDA
          userTokenAccount: bobTokenAccount.address,
          userRewardAccount: bobRewardAccount.address,
          poolVault: poolVaultPda,
          rewardVault: poolAccount.rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMint: tokenMint,
        })
        .signers([bob])
        .rpc();

      // If we reach here, the test failed - Bob was able to withdraw
      throw new Error(
        "❌ SECURITY FAILURE: Bob was able to withdraw from Alice's stake account!"
      );
    } catch (err: any) {
      // Expected to fail with Unauthorized error
      const errMsg = err.error?.errorMessage || err.message;
      console.log("✅ Expected error caught:", errMsg);

      // Verify it's the correct error (Unauthorized)
      expect(
        errMsg.includes("Unauthorized") ||
          errMsg.includes("A raw constraint was violated")
      ).to.be.true;
    }

    // Verify Alice's stake is unchanged
    const aliceStakeAfter = await program.account.userStake.fetch(
      aliceStakePda
    );
    console.log(
      "\n✅ Alice's stake remains unchanged:",
      aliceStakeAfter.amount.toString()
    );
    expect(aliceStakeAfter.amount.toString()).to.equal(STAKE_AMOUNT.toString());

    // Verify Alice can still withdraw her own stake
    console.log("\n🔹 Alice withdraws from her own stake...");

    const aliceRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      alice,
      rewardMint,
      alice.publicKey
    );

    await program.methods
      .withdrawStake(poolId, WITHDRAW_AMOUNT)
      .accounts({
        pool: poolPda,
        user: alice.publicKey,
        userStake: aliceStakePda,
        userTokenAccount: aliceTokenAccount.address,
        userRewardAccount: aliceRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([alice])
      .rpc();

    const aliceStakeFinal = await program.account.userStake.fetch(
      aliceStakePda
    );
    const expectedAmount = STAKE_AMOUNT.sub(WITHDRAW_AMOUNT);
    console.log("✅ Alice successfully withdrew:", WITHDRAW_AMOUNT.toString());
    console.log("   Remaining stake:", aliceStakeFinal.amount.toString());
    expect(aliceStakeFinal.amount.toString()).to.equal(
      expectedAmount.toString()
    );

    console.log(
      "\n🎉 SECURITY TEST PASSED: Unauthorized withdrawal blocked successfully!"
    );
  });

  it("✅ User can only withdraw from their own stake account", async () => {
    console.log(
      "\n================= 🧪 OWN STAKE WITHDRAWAL TEST =================\n"
    );

    // Create a new user for this test
    const charlie = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(charlie.publicKey, 2_000_000_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("👤 Charlie:", charlie.publicKey.toBase58());

    // Setup Charlie's accounts
    const charlieTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      charlie.publicKey
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );
    const [charlieStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        charlie.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Mint tokens to Charlie
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      charlieTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT
    );

    console.log("\n🔹 Charlie stakes 300 tokens...");

    // Charlie stakes tokens
    const STAKE_AMOUNT = new anchor.BN(300_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: poolPda,
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

    console.log("✅ Charlie staked successfully");

    // Charlie withdraws his own stake
    console.log("\n🔹 Charlie withdraws from his own stake...");

    const charlieRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      charlie,
      rewardMint,
      charlie.publicKey
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const WITHDRAW_AMOUNT = new anchor.BN(150_000_000);

    await program.methods
      .withdrawStake(poolId, WITHDRAW_AMOUNT)
      .accounts({
        pool: poolPda,
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

    const charlieStakeFinal = await program.account.userStake.fetch(
      charlieStakePda
    );
    const expectedAmount = STAKE_AMOUNT.sub(WITHDRAW_AMOUNT);
    console.log(
      "✅ Charlie successfully withdrew:",
      WITHDRAW_AMOUNT.toString()
    );
    console.log("   Remaining stake:", charlieStakeFinal.amount.toString());
    expect(charlieStakeFinal.amount.toString()).to.equal(
      expectedAmount.toString()
    );

    console.log("\n🎉 TEST PASSED: User can withdraw from their own stake!");
  });

  it("❌ Unauthorized user cannot claim rewards from another user's stake account", async () => {
    console.log(
      "\n================= 🧪 UNAUTHORIZED CLAIM REWARD TEST =================\n"
    );

    // Create two users: David (legitimate owner) and Eve (attacker)
    const david = anchor.web3.Keypair.generate();
    const eve = anchor.web3.Keypair.generate();

    // Airdrop SOL to both users
    await provider.connection.requestAirdrop(david.publicKey, 2_000_000_000);
    await provider.connection.requestAirdrop(eve.publicKey, 2_000_000_000);

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("👤 David (legitimate owner):", david.publicKey.toBase58());
    console.log("👤 Eve (attacker):", eve.publicKey.toBase58());

    // Setup David's accounts
    const davidTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      david.publicKey
    );

    const davidRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      david,
      rewardMint,
      david.publicKey
    );

    // PDAs
    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );
    const [davidStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        david.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Mint tokens to David
    const MINT_AMOUNT = 1_000_000_000;
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      davidTokenAccount.address,
      admin.publicKey,
      MINT_AMOUNT
    );

    console.log("\n🔹 David stakes 600 tokens...");

    // David stakes tokens
    const STAKE_AMOUNT = new anchor.BN(600_000_000);
    await program.methods
      .depositStake(poolId, STAKE_AMOUNT)
      .accounts({
        pool: poolPda,
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

    console.log("✅ David staked successfully");

    // Wait a bit to accrue some rewards
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify David's stake has some unclaimed rewards or staked amount
    const davidStakeAccount = await program.account.userStake.fetch(
      davidStakePda
    );
    console.log("David's stake amount:", davidStakeAccount.amount.toString());
    console.log(
      "David's unclaimed rewards:",
      davidStakeAccount.unclaimed.toString()
    );
    expect(davidStakeAccount.owner.toBase58()).to.equal(
      david.publicKey.toBase58()
    );

    // Setup Eve's accounts (attacker)
    const eveRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      eve,
      rewardMint,
      eve.publicKey
    );

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "\n🔹 Eve (attacker) attempts to claim rewards from David's stake..."
    );

    // Eve tries to claim rewards from David's stake account
    try {
      await program.methods
        .claimReward(poolId)
        .accounts({
          pool: poolPda,
          user: eve.publicKey, // Eve is the signer
          userStake: davidStakePda, // But trying to use David's stake PDA
          userRewardAccount: eveRewardAccount.address,
          rewardVault: poolAccount.rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([eve])
        .rpc();

      // If we reach here, the test failed - Eve was able to claim David's rewards
      throw new Error(
        "❌ SECURITY FAILURE: Eve was able to claim rewards from David's stake account!"
      );
    } catch (err: any) {
      // Expected to fail with Unauthorized error
      const errMsg = err.error?.errorMessage || err.message;
      console.log("✅ Expected error caught:", errMsg);

      // Verify it's the correct error (Unauthorized)
      expect(
        errMsg.includes("Unauthorized") ||
          errMsg.includes("A raw constraint was violated")
      ).to.be.true;
    }

    // Verify David's stake is unchanged
    const davidStakeAfter = await program.account.userStake.fetch(
      davidStakePda
    );
    console.log(
      "\n✅ David's stake remains unchanged:",
      davidStakeAfter.amount.toString()
    );
    expect(davidStakeAfter.amount.toString()).to.equal(STAKE_AMOUNT.toString());

    // Verify David can still claim his own rewards
    console.log("\n🔹 David claims his own rewards...");

    const davidRewardBefore = await getAccount(
      provider.connection,
      davidRewardAccount.address
    );

    await program.methods
      .claimReward(poolId)
      .accounts({
        pool: poolPda,
        user: david.publicKey,
        userStake: davidStakePda,
        userRewardAccount: davidRewardAccount.address,
        rewardVault: poolAccount.rewardVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([david])
      .rpc();

    const davidRewardAfter = await getAccount(
      provider.connection,
      davidRewardAccount.address
    );
    const rewardsClaimed = davidRewardAfter.amount - davidRewardBefore.amount;

    console.log(
      "✅ David successfully claimed rewards:",
      rewardsClaimed.toString()
    );
    expect(Number(rewardsClaimed)).to.be.greaterThan(0);

    console.log(
      "\n🎉 SECURITY TEST PASSED: Unauthorized claim reward blocked successfully!"
    );
  });
});
