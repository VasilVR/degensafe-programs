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

describe("🔐 Stake Program - PDA Seed Validation", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let rewardVaultPda: anchor.web3.PublicKey;
  let wrongTokenMint: anchor.web3.PublicKey;
  let wrongPoolPda: anchor.web3.PublicKey;
  const poolId = new anchor.BN(0); // Define at module level for reuse across tests

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    // Create primary token mint for staking
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      tokenMintKeypair
    );

    // Create a second token mint to test wrong PDA
    const wrongTokenMintKeypair = anchor.web3.Keypair.generate();
    wrongTokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      wrongTokenMintKeypair
    );

    // Same-token enforcement: reward mint must equal staking token mint
    rewardMint = tokenMint;

    // Create pool for correct token mint
    const rewardPercentage = 1000; // 10.00% APY
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Derive correct pool PDA
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive wrong pool PDA (using wrongTokenMint)
    [wrongPoolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), wrongTokenMint.toBuffer()],
      program.programId
    );

    [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    // Enable staking on the pool
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Deposit rewards
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
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("✅ Test setup completed");
    console.log("   Correct token mint:", tokenMint.toBase58());
    console.log("   Wrong token mint:", wrongTokenMint.toBase58());
    console.log("   Correct pool PDA:", poolPda.toBase58());
    console.log("   Wrong pool PDA:", wrongPoolPda.toBase58());
  });

  describe("GetPoolInfo - PDA Validation", () => {
    it("❌ Should reject pool with wrong token mint", async () => {
      console.log("\n=== Testing GetPoolInfo with wrong token mint ===");

      try {
        // Try to call getPoolInfo with the correct pool but wrong tokenMint
        // This should fail seed validation
        await program.methods
          .getPoolInfo(poolId)
          .accounts({
            pool: poolPda,
            tokenMint: wrongTokenMint, // Wrong token mint!
          })
          .rpc();

        expect.fail("Should have thrown an error for wrong token mint");
      } catch (error) {
        console.log("   ✓ Correctly rejected with error:", error.message);
        // Anchor throws a seeds constraint error
        expect(error.message).to.include("seeds constraint");
      }
    });

    it("✅ Should accept pool with correct token mint", async () => {
      console.log("\n=== Testing GetPoolInfo with correct token mint ===");

      const poolInfo = await program.methods
        .getPoolInfo(poolId)
        .accounts({
          pool: poolPda,
          tokenMint: tokenMint, // Correct token mint
        })
        .rpc();

      console.log("   ✓ Successfully retrieved pool info");
      expect(poolInfo).to.exist;
    });
  });

  describe("SetStakingActive - PDA Validation", () => {
    it("❌ Should reject pool with wrong token mint", async () => {
      console.log("\n=== Testing SetStakingActive with wrong token mint ===");

      try {
        await program.methods
          .setStakingActive(poolId, false)
          .accounts({
            pool: poolPda,
            admin: admin.publicKey,
            tokenMint: wrongTokenMint, // Wrong token mint!
          })
          .rpc();

        expect.fail("Should have thrown an error for wrong token mint");
      } catch (error) {
        console.log("   ✓ Correctly rejected with error:", error.message);
        expect(error.message).to.include("seeds constraint");
      }
    });

    it("✅ Should accept pool with correct token mint", async () => {
      console.log("\n=== Testing SetStakingActive with correct token mint ===");

      await program.methods
        .setStakingActive(poolId, false)
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          tokenMint: tokenMint, // Correct token mint
        })
        .rpc();

      console.log("   ✓ Successfully updated staking status");

      // Re-enable for other tests
      await program.methods
        .setStakingActive(poolId, true)
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          tokenMint: tokenMint,
        })
        .rpc();
    });
  });

  describe("DepositReward - PDA Validation", () => {
    it("❌ Should reject pool with wrong token mint", async () => {
      console.log("\n=== Testing DepositReward with wrong token mint ===");

      const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        rewardMint,
        admin.publicKey
      );

      try {
        await program.methods
          .depositReward(poolId, new anchor.BN(1000))
          .accounts({
            pool: poolPda,
            admin: admin.publicKey,
            tokenMint: wrongTokenMint, // Wrong token mint!
            adminRewardAccount: adminRewardAccount.address,
            rewardVault: rewardVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        expect.fail("Should have thrown an error for wrong token mint");
      } catch (error) {
        console.log("   ✓ Correctly rejected with error:", error.message);
        expect(error.message).to.include("seeds constraint");
      }
    });
  });

  describe("UpdateRewardPercentage - PDA Validation", () => {
    it("❌ Should reject pool with wrong token mint", async () => {
      console.log(
        "\n=== Testing UpdateRewardPercentage with wrong token mint ==="
      );

      try {
        await program.methods
          .updateRewardPercentage(poolId, new anchor.BN(2000))
          .accounts({
            pool: poolPda,
            admin: admin.publicKey,
            tokenMint: wrongTokenMint, // Wrong token mint!
          })
          .rpc();

        expect.fail("Should have thrown an error for wrong token mint");
      } catch (error) {
        console.log("   ✓ Correctly rejected with error:", error.message);
        expect(error.message).to.include("seeds constraint");
      }
    });

    it("✅ Should accept pool with correct token mint", async () => {
      console.log(
        "\n=== Testing UpdateRewardPercentage with correct token mint ==="
      );

      await program.methods
        .updateRewardPercentage(poolId, new anchor.BN(1500))
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          tokenMint: tokenMint, // Correct token mint
        })
        .rpc();

      console.log("   ✓ Successfully updated reward percentage");
    });
  });

  describe("DepositStake - PDA Validation", () => {
    it("❌ Should reject pool with wrong token mint", async () => {
      console.log("\n=== Testing DepositStake with wrong token mint ===");

      const user = anchor.web3.Keypair.generate();

      // Airdrop SOL to user
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          user.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        )
      );

      // Create user token account and mint tokens
      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        tokenMint,
        user.publicKey
      );

      await mintTo(
        provider.connection,
        admin.payer,
        tokenMint,
        userTokenAccount.address,
        admin.publicKey,
        1_000_000
      );

      const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .depositStake(poolId, new anchor.BN(100_000))
          .accounts({
            pool: poolPda,
            user: user.publicKey,
            tokenMint: wrongTokenMint, // Wrong token mint!
            userTokenAccount: userTokenAccount.address,
            poolVault: poolVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        expect.fail("Should have thrown an error for wrong token mint");
      } catch (error) {
        console.log("   ✓ Correctly rejected with error:", error.message);
        expect(error.message).to.include("seeds constraint");
      }
    });
  });

  console.log("\n=== All PDA validation tests completed ===");
});
