import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, getMint } from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔧 Stake Program - Pool Configuration", () => {
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

    // Create pool for configuration tests
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

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mint = token mint (same-token):", rewardMint.toBase58());
  });

  it("5. ✅ Admin updates reward percentage", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const newPercentage = 2500; // 25.00% APY in basis points

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(newPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "✅ Reward percentage updated to:",
      poolAccount.rewardPercentage.toString()
    );

    expect(poolAccount.rewardPercentage.toNumber()).to.equal(newPercentage);
  });

  it("6. ❌ Fails to update reward percentage if not pool owner", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const nonOwner = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .updateRewardPercentage(poolId, new anchor.BN(7777))
        .accounts({
          pool: poolPda,
          admin: nonOwner.publicKey,
          tokenMint: tokenMint,
        })
        .signers([nonOwner])
        .rpc();

      throw new Error("Unexpected success by non-owner");
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log("❌ Expected Unauthorized error:", errMsg);

      expect(errMsg).to.include("Unauthorized");
    }
  });

  it("7. 📌 Pool info unchanged after failed percentage update attempt", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const info = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📌 After failed update attempt:", {
      rewardPercentage: info.rewardPercentage.toString(),
    });

    expect(info.rewardPercentage.toNumber()).to.equal(2500);
  });

  it("7a. ✅ Admin can set reward percentage to 0 (no-reward staking)", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(0))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "✅ Reward percentage set to 0:",
      poolAccount.rewardPercentage.toString()
    );
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(0);
  });

  it("7b. ✅ Admin can set high reward percentage (e.g., 500000 bps = 5000% APY)", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const highPercentage = 500000; // 5000% APY in basis points - high but within limits

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(highPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "✅ Reward percentage set to:",
      poolAccount.rewardPercentage.toString()
    );
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(highPercentage);
  });

  it("7c. ❌ Fails to set reward percentage above 100,000,000 bps (prevents typos)", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const excessivePercentage = 100_000_001; // Just over the limit (1,000,000% APY)

    try {
      await program.methods
        .updateRewardPercentage(poolId, new anchor.BN(excessivePercentage))
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Update did not fail as expected");
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

  it("7d. ✅ Admin can set reward percentage at the limit (100,000,000 bps = 1,000,000% APY)", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const maxPercentage = 100_000_000; // Exactly at the limit

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(maxPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      "✅ Reward percentage set to max:",
      poolAccount.rewardPercentage.toString()
    );
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(maxPercentage);
  });

  it("7e. ✅ Reset reward percentage back to 2500 bps for consistency", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .updateRewardPercentage(poolId, new anchor.BN(2500)) // 25.00% APY
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(2500);
    console.log("✅ Reward percentage reset to 2500");
  });
});
