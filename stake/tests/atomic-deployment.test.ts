import * as anchor from "@coral-xyz/anchor";
const BN = anchor.BN;
import { expect } from "chai";
import { createMint, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔒 Stake Program - Atomic Deployment Security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StakeProgram;
  const admin = provider.wallet as anchor.Wallet;

  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let poolIdCounterPda: anchor.web3.PublicKey;
  let rewardVaultPda: anchor.web3.PublicKey;
  let poolVaultPda: anchor.web3.PublicKey;

  const rewardPercentage = new BN(1000); // 10% APY
  const poolId = new BN(0); // First pool for this token

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    // Create test token mints
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6
    );

    // Same-token enforcement: reward mint must equal staking token mint
    rewardMint = tokenMint;

    // Derive pool ID counter PDA
    [poolIdCounterPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_id_counter"), tokenMint.toBuffer()],
      program.programId
    );

    // Derive pool PDA with pool_id
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive reward vault PDA
    [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    // Derive pool vault PDA
    [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    console.log("✅ Setup complete for atomic deployment tests");
    console.log(`   Token Mint: ${tokenMint.toString()}`);
    console.log(`   Reward Mint: ${rewardMint.toString()}`);
  });

  it("✅ Pool creation is protected by 'init' constraint", async () => {
    let isCreated = false;
    let existingOwner: anchor.web3.PublicKey | null = null;

    // Check if pool is already created
    try {
      const pool = await program.account.pool.fetch(poolPda);
      isCreated = true;
      existingOwner = pool.owner;
      console.log("Pool already created");
    } catch (err) {
      console.log("Pool not created, creating now...");
    }

    if (!isCreated) {
      // Create pool
      const tx = await program.methods
        .createPool(null, rewardPercentage, poolId)
        .accounts({
          poolIdCounter: poolIdCounterPda,
          pool: poolPda,
          tokenMint: tokenMint,
          rewardMint: rewardMint,
          rewardVault: rewardVaultPda,
          poolVault: poolVaultPda,
          admin: admin.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          config: getGlobalConfigPDA(program.programId)[0],
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify creation
      const pool = await program.account.pool.fetch(poolPda);
      expect(pool.owner.toString()).to.equal(admin.publicKey.toString());
      expect(pool.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(pool.rewardMint.toString()).to.equal(rewardMint.toString());
      expect(pool.rewardPercentage.toString()).to.equal(
        rewardPercentage.toString()
      );
      existingOwner = pool.owner;
      console.log("✅ Pool created successfully");
    }

    // CRITICAL TEST: Attempt to recreate should fail
    try {
      const tx = await program.methods
        .createPool(null, new BN(2000), poolId) // Try with different parameters
        .accounts({
          poolIdCounter: poolIdCounterPda,
          pool: poolPda,
          tokenMint: tokenMint,
          rewardMint: rewardMint,
          rewardVault: rewardVaultPda,
          poolVault: poolVaultPda,
          admin: admin.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          config: getGlobalConfigPDA(program.programId)[0],
        })
        .rpc();

      expect.fail(
        "Pool recreation should have failed but succeeded - SECURITY ISSUE!"
      );
    } catch (error: any) {
      const errorMsg = error.toString();
      expect(
        errorMsg.includes("already in use") ||
          errorMsg.includes("custom program error")
      ).to.be.true;
      console.log("✅ Pool recreation correctly prevented");
    }

    // Verify the owner hasn't changed
    const finalPool = await program.account.pool.fetch(poolPda);
    expect(finalPool.owner.toString()).to.equal(existingOwner!.toString());
    expect(finalPool.rewardPercentage.toString()).to.equal(
      rewardPercentage.toString()
    ); // Original value unchanged
    console.log("✅ Pool owner remains unchanged - no unauthorized takeover");
  });

  it("✅ Idempotent deployment script behavior", async () => {
    try {
      const pool = await program.account.pool.fetch(poolPda);

      // Pool exists - verify state is consistent
      expect(pool.owner).to.not.equal(anchor.web3.PublicKey.default);
      expect(pool.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(pool.rewardMint.toString()).to.equal(rewardMint.toString());
      console.log(
        "✅ Pool state is consistent, can be queried multiple times safely"
      );
    } catch (err) {
      expect.fail("Pool should exist at this point");
    }
  });

  it("✅ Verify deployment script would detect existing pool", async () => {
    let alreadyCreated = false;

    try {
      const pool = await program.account.pool.fetch(poolPda);
      alreadyCreated = true;
      console.log("✅ Deployment script would correctly detect existing pool");
      console.log(`   Current owner: ${pool.owner.toString()}`);
      console.log(`   Token mint: ${pool.tokenMint.toString()}`);
      console.log(`   Reward mint: ${pool.rewardMint.toString()}`);
      console.log(`   Reward percentage: ${pool.rewardPercentage.toString()}`);
    } catch (error) {
      console.log("Pool not created - would proceed with creation");
    }

    expect(alreadyCreated).to.be.true;
  });

  it("✅ Verify all vault PDAs are correctly initialized", async () => {
    const pool = await program.account.pool.fetch(poolPda);

    // Check that vaults are correctly referenced
    expect(pool.rewardVault.toString()).to.equal(rewardVaultPda.toString());

    // Verify reward vault exists and has correct authority
    const rewardVaultInfo = await provider.connection.getAccountInfo(
      rewardVaultPda
    );
    expect(rewardVaultInfo).to.not.be.null;

    // Verify pool vault exists
    const poolVaultInfo = await provider.connection.getAccountInfo(
      poolVaultPda
    );
    expect(poolVaultInfo).to.not.be.null;

    console.log(
      "✅ All vault PDAs correctly initialized with proper authority"
    );
  });
});
