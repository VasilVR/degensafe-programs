import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment, getPoolPDA, poolIdToBytes , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔢 Stake Program - Multiple Pools per Token", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint1: anchor.web3.PublicKey;
  let rewardMint2: anchor.web3.PublicKey;

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

    // Same-token enforcement: all reward mints must equal staking token mint
    rewardMint1 = tokenMint;
    rewardMint2 = tokenMint;

    console.log("✅ Token mint created:", tokenMint.toBase58());
    console.log("✅ Reward mints = token mint (same-token):", tokenMint.toBase58());
  });

  it("1. ✅ Creates first pool (pool_id = 0) for token mint", async () => {
    const rewardPercentage = 1000; // 10.00% APY

    // Derive pool_id_counter PDA
    const [poolIdCounterPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_id_counter"), tokenMint.toBuffer()],
      program.programId
    );

    // First pool should have pool_id = 0
    const poolId = 0;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), new anchor.BN(poolId))
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint1,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Verify pool
    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolAccount.rewardMint.toBase58()).to.equal(rewardMint1.toBase58());
    expect(poolAccount.poolId.toNumber()).to.equal(0);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(rewardPercentage);

    // Verify counter
    const counterAccount = await program.account.poolIdCounter.fetch(
      poolIdCounterPda
    );
    expect(counterAccount.nextPoolId.toNumber()).to.equal(1);
    expect(counterAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());

    console.log("✅ First pool created with pool_id:", poolAccount.poolId.toNumber());
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Next pool_id in counter:", counterAccount.nextPoolId.toNumber());
  });

  it("2. ✅ Creates second pool (pool_id = 1) for same token mint", async () => {
    const rewardPercentage = 2500; // 25.00% APY (different from first pool)

    // Second pool should have pool_id = 1
    const poolId = 1;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    const [poolIdCounterPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_id_counter"), tokenMint.toBuffer()],
      program.programId
    );

    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), new anchor.BN(poolId))
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint2,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Verify second pool
    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolAccount.rewardMint.toBase58()).to.equal(rewardMint2.toBase58());
    expect(poolAccount.poolId.toNumber()).to.equal(1);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(rewardPercentage);

    // Verify counter incremented
    const counterAccount = await program.account.poolIdCounter.fetch(
      poolIdCounterPda
    );
    expect(counterAccount.nextPoolId.toNumber()).to.equal(2);

    console.log("✅ Second pool created with pool_id:", poolAccount.poolId.toNumber());
    console.log("   Pool PDA:", poolPda.toBase58());
    console.log("   Next pool_id in counter:", counterAccount.nextPoolId.toNumber());
  });

  it("3. ✅ Creates third pool (pool_id = 2) for same token mint", async () => {
    const rewardPercentage = 500; // 5.00% APY (different from both pools)

    // Third pool should have pool_id = 2
    const poolId = 2;
    const [poolPda] = getPoolPDA(program.programId, tokenMint, poolId);

    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage), new anchor.BN(poolId))
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint1, // Reuse first reward mint
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Verify third pool
    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.poolId.toNumber()).to.equal(2);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(rewardPercentage);

    console.log("✅ Third pool created with pool_id:", poolAccount.poolId.toNumber());
    console.log("   Pool PDA:", poolPda.toBase58());
  });

  it("4. ✅ Retrieves pool info for different pools", async () => {
    // Get info for pool 0
    const poolId0 = 0;
    const [pool0Pda] = getPoolPDA(program.programId, tokenMint, poolId0);

    const pool0Info = await program.methods
      .getPoolInfo(new anchor.BN(poolId0))
      .accounts({
        pool: pool0Pda,
        tokenMint: tokenMint,
      })
      .view();

    expect(pool0Info.poolId.toNumber()).to.equal(0);
    expect(pool0Info.rewardPercentage.toNumber()).to.equal(1000);

    // Get info for pool 1
    const poolId1 = 1;
    const [pool1Pda] = getPoolPDA(program.programId, tokenMint, poolId1);

    const pool1Info = await program.methods
      .getPoolInfo(new anchor.BN(poolId1))
      .accounts({
        pool: pool1Pda,
        tokenMint: tokenMint,
      })
      .view();

    expect(pool1Info.poolId.toNumber()).to.equal(1);
    expect(pool1Info.rewardPercentage.toNumber()).to.equal(2500);

    console.log("✅ Pool 0 info:", {
      poolId: pool0Info.poolId.toNumber(),
      rewardPercentage: pool0Info.rewardPercentage.toNumber(),
    });
    console.log("✅ Pool 1 info:", {
      poolId: pool1Info.poolId.toNumber(),
      rewardPercentage: pool1Info.rewardPercentage.toNumber(),
    });
  });

  it("5. ✅ Verifies each pool has independent configuration", async () => {
    // Fetch all three pools
    const pools = [];
    for (let i = 0; i < 3; i++) {
      const [poolPda] = getPoolPDA(program.programId, tokenMint, i);
      const poolAccount = await program.account.pool.fetch(poolPda);
      pools.push(poolAccount);
    }

    // Verify they all share the same token mint
    expect(pools[0].tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(pools[1].tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(pools[2].tokenMint.toBase58()).to.equal(tokenMint.toBase58());

    // Verify they have different pool IDs
    expect(pools[0].poolId.toNumber()).to.equal(0);
    expect(pools[1].poolId.toNumber()).to.equal(1);
    expect(pools[2].poolId.toNumber()).to.equal(2);

    // Verify they have different reward percentages
    expect(pools[0].rewardPercentage.toNumber()).to.equal(1000);
    expect(pools[1].rewardPercentage.toNumber()).to.equal(2500);
    expect(pools[2].rewardPercentage.toNumber()).to.equal(500);

    // Verify they have different reward mints
    expect(pools[0].rewardMint.toBase58()).to.equal(rewardMint1.toBase58());
    expect(pools[1].rewardMint.toBase58()).to.equal(rewardMint2.toBase58());
    expect(pools[2].rewardMint.toBase58()).to.equal(rewardMint1.toBase58());

    console.log("✅ All pools verified as independent with correct configurations");
  });
});
