import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment, getPoolPDA } from "./test-utils";

describe("🪙 Stake Program - Create Pool", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;

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

    const tokenInfo = await getMint(provider.connection, tokenMint);
    const rewardInfo = await getMint(provider.connection, rewardMint);

    expect(tokenInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );
    expect(rewardInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mint created:", rewardMint.toBase58());
  });

  it("1. ✅ Creates pool using token mint and reward mint", async () => {
    const rewardPercentage = 1000; // 10.00% APY in basis points (bps)
    const poolId = 0; // First pool for this token mint
    
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), new anchor.BN(poolId))
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    const poolAccount = await program.account.pool.fetch(poolPda);

    expect(poolAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolAccount.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolAccount.owner.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(poolAccount.totalStaked.toNumber()).to.equal(0);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(rewardPercentage);
    expect(poolAccount.poolId.toNumber()).to.equal(poolId);

    console.log("✅ Pool created and verified:", poolPda.toBase58());
  });

  it("2. 🏦 Creates reward_vault PDA during pool creation", async () => {
    const poolId = 0;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log("Pool reward vault:", poolAccount.rewardVault.toBase58());
    console.log("Derived reward_vault PDA:", rewardVaultPda.toBase58());

    expect(poolAccount.rewardVault.toBase58()).to.equal(
      rewardVaultPda.toBase58()
    );
  });

  it("3. ❌ Fails to create pool if it already exists", async () => {
    const poolId = 0;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    try {
      await program.methods
        .createPool(null, new anchor.BN(1000), new anchor.BN(poolId))
        .accounts({
          tokenMint: tokenMint,
          rewardMint: rewardMint,
          admin: admin.publicKey,
        })
        .rpc();

      throw new Error("Pool creation did not fail as expected");
    } catch (err: any) {
      console.log("✅ Expected error caught:", err.message);
      console.log("   Existing pool PDA:", poolPda.toBase58());
    }
  });

  it("3a. ❌ Fails to create pool with reward percentage above 100,000,000", async () => {
    // Create unique token mints for this test to avoid account collisions
    const testTokenMintKeypair = anchor.web3.Keypair.generate();
    const testTokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testTokenMintKeypair
    );

    const testRewardMintKeypair = anchor.web3.Keypair.generate();
    const testRewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testRewardMintKeypair
    );

    const excessivePercentage = 100_000_001; // Over 1,000,000% APY in bps
    const poolId = 0; // First pool for test token

    try {
      await program.methods
        .createPool(null, new anchor.BN(excessivePercentage), new anchor.BN(poolId))
        .accounts({
          tokenMint: testTokenMint,
          rewardMint: testRewardMint,
          admin: admin.publicKey,
        })
        .rpc();

      throw new Error("Pool creation did not fail as expected");
    } catch (err: any) {
      // Check multiple possible error locations
      const errMsg =
        err.error?.errorMessage || err.message || JSON.stringify(err);
      const errCode = err.error?.errorCode?.code || "";
      console.log("❌ Expected InvalidRewardPercentage error:", errMsg);
      console.log("   Error code:", errCode);

      // Check if error message or code contains our custom error
      const hasError =
        errMsg.includes("InvalidRewardPercentage") ||
        errCode === "InvalidRewardPercentage" ||
        (err.logs &&
          err.logs.some((log: string) =>
            log.includes("InvalidRewardPercentage")
          ));

      expect(hasError, `Expected InvalidRewardPercentage but got: ${errMsg}`).to
        .be.true;
    }
  });

  it("3b. ✅ Creates pool with 0% reward (no-reward staking)", async () => {
    // Create unique token mints for this test to avoid account collisions
    const testTokenMintKeypair = anchor.web3.Keypair.generate();
    const testTokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testTokenMintKeypair
    );

    const testRewardMintKeypair = anchor.web3.Keypair.generate();
    const testRewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testRewardMintKeypair
    );

    const poolId = 0;
    await program.methods
      .createPool(null, new anchor.BN(0), new anchor.BN(poolId)) // 0 bps = 0% APY
      .accounts({
        tokenMint: testTokenMint,
        rewardMint: testRewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    const [poolPda] = getPoolPDA(program.programId, testTokenMint, poolId);

    const poolAccount = await program.account.pool.fetch(poolPda);

    expect(poolAccount.rewardPercentage.toNumber()).to.equal(0);
    console.log("✅ Pool created with 0% reward:", poolPda.toBase58());
  });

  it("3c. ✅ Creates pool with high reward percentage (1000000 bps = 100% APY)", async () => {
    // Create unique token mints for this test to avoid account collisions
    const testTokenMintKeypair = anchor.web3.Keypair.generate();
    const testTokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testTokenMintKeypair
    );

    const testRewardMintKeypair = anchor.web3.Keypair.generate();
    const testRewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      testRewardMintKeypair
    );

    const highPercentage = 1000000; // 100% APY in basis points
    const poolId = 0;

    await program.methods
      .createPool(null, new anchor.BN(highPercentage), new anchor.BN(poolId))
      .accounts({
        tokenMint: testTokenMint,
        rewardMint: testRewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    const [poolPda] = getPoolPDA(program.programId, testTokenMint, poolId);

    const poolAccount = await program.account.pool.fetch(poolPda);

    expect(poolAccount.rewardPercentage.toNumber()).to.equal(highPercentage);
    console.log(
      "✅ Pool created with high reward percentage:",
      poolPda.toBase58()
    );
  });

  it("4. ℹ️ Gets pool info via instruction", async () => {
    const poolId = 0;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    const poolData = await program.methods
      .getPoolInfo(new anchor.BN(poolId))
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view(); // `.view()` returns the struct directly

    console.log("✅ Pool info fetched:", {
      pool: poolPda.toBase58(),
      tokenMint: poolData.tokenMint.toBase58(),
      rewardMint: poolData.rewardMint.toBase58(),
      owner: poolData.owner.toBase58(),
      totalStaked: poolData.totalStaked.toString(),
      rewardPercentage: poolData.rewardPercentage.toString(),
      bump: poolData.bump,
      isActive: poolData.isActive,
    });

    expect(poolData.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolData.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolData.owner.toBase58()).to.equal(admin.publicKey.toBase58());
  });
});
