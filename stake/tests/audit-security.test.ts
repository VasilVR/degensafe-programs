/**
 * Guardian Audits Security Remediation Tests
 * 
 * Tests for security fixes implemented per audit findings:
 * - Decimal validation in create_pool
 * - Guard update_reward_mint (only when total_staked == 0)
 * - Restrict create_pool to program upgrade authority
 * - Enforce canonical ATA for admin reward accounts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { StakeProgram } from "../target/types/stake_program";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🔒 Audit Security Validations", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StakeProgram as Program<StakeProgram>;
  
  const admin = (provider.wallet as anchor.Wallet).payer;
  let tokenMint: PublicKey;
  let rewardMint: PublicKey;
  
  // Helper to derive pool PDA
  function derivePoolPda(mint: PublicKey, poolId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), mint.toBuffer(), new BN(poolId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }
  
  // Helper to derive pool ID counter PDA
  function derivePoolIdCounterPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool_id_counter"), mint.toBuffer()],
      program.programId
    );
  }
  
  // Helper to derive reward vault PDA
  function deriveRewardVaultPda(pool: PublicKey, rewardMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), pool.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );
  }
  
  // Helper to get program data address
  function getProgramDataAddress(): PublicKey {
    const [programData] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    );
    return programData;
  }

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    // Create token mint with 9 decimals
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      9
    );
    
    // Same-token enforcement: reward mint must equal staking token mint
    rewardMint = tokenMint;
    
    console.log("✅ Test setup complete");
    console.log("   Token Mint:", tokenMint.toBase58());
    console.log("   Reward Mint = Token Mint (same-token):", rewardMint.toBase58());
  });

  describe(" Same-Token Enforcement", () => {
    it("🚫 Rejects pool creation with different reward mint", async () => {
      // Create a different mint (even with same decimals)
      const differentRewardMint = await createMint(
        provider.connection,
        admin,
        admin.publicKey,
        null,
        9 // Same decimals, but different mint
      );
      
      const [poolIdCounter] = derivePoolIdCounterPda(tokenMint);
      const [pool] = derivePoolPda(tokenMint, 0);
      const [rewardVault] = deriveRewardVaultPda(pool, differentRewardMint);
      
      try {
        await program.methods
          .createPool(null, new BN(1000), new BN(0))
          .accounts({
            poolIdCounter,
            pool,
            tokenMint,
            rewardMint: differentRewardMint,
            rewardVault,
            admin: admin.publicKey,
            config: getGlobalConfigPDA(program.programId)[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        
        expect.fail("Should have thrown RewardMintMustMatchStakeMint error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code || err.message).to.include("RewardMintMustMatchStakeMint");
        console.log("✅ Correctly rejected different reward mint");
      }
    });

    it("✅ Accepts pool creation with same token as reward", async () => {
      const [poolIdCounter] = derivePoolIdCounterPda(tokenMint);
      const [pool] = derivePoolPda(tokenMint, 0);
      const [rewardVault] = deriveRewardVaultPda(pool, rewardMint);
      
      await program.methods
        .createPool(null, new BN(1000), new BN(0))
        .accounts({
          poolIdCounter,
          pool,
          tokenMint,
          rewardMint,
          rewardVault,
          admin: admin.publicKey,
          config: getGlobalConfigPDA(program.programId)[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log("✅ Pool created with same-token reward");
    });
  });

  describe(" Guard update_reward_mint", () => {
    let testTokenMint: PublicKey;
    let testRewardMint: PublicKey;
    let newRewardMint: PublicKey;
    let poolPda: PublicKey;
    
    before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

      // Create fresh mints for this test
      testTokenMint = await createMint(
        provider.connection,
        admin,
        admin.publicKey,
        null,
        9
      );
      
      // Same-token enforcement: pool must be created with reward = stake token
      testRewardMint = testTokenMint;
      
      // New reward mint for update_reward_mint test (allowed post-creation when no stakers)
      newRewardMint = await createMint(
        provider.connection,
        admin,
        admin.publicKey,
        null,
        9
      );
      
      // Create a pool
      const [poolIdCounter] = derivePoolIdCounterPda(testTokenMint);
      [poolPda] = derivePoolPda(testTokenMint, 0);
      const [rewardVault] = deriveRewardVaultPda(poolPda, testRewardMint);
      const programData = getProgramDataAddress();
      
      await program.methods
        .createPool(null, new BN(1000), new BN(0))
        .accounts({
          poolIdCounter,
          pool: poolPda,
          tokenMint: testTokenMint,
          rewardMint: testRewardMint,
          rewardVault,
          admin: admin.publicKey,
          config: getGlobalConfigPDA(program.programId)[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    });

    it("✅ Allows reward mint update when no stakers", async () => {
      const [newRewardVault] = deriveRewardVaultPda(poolPda, newRewardMint);
      
      // This should work since total_staked == 0
      await program.methods
        .updateRewardMint(new BN(0))
        .accounts({
          pool: poolPda,
          newRewardMint,
          newRewardVault,
          admin: admin.publicKey,
          tokenMint: testTokenMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log("✅ Reward mint updated when pool empty");
    });
    
    // Note: Testing rejection with active stakers would require depositing stake first
    // which is covered in other test files
  });

  describe(" Restrict create_pool to Program Authority", () => {
    it("🚫 Rejects pool creation from non-authority", async () => {
      // Create a new keypair that is NOT the upgrade authority
      const nonAuthority = Keypair.generate();
      
      // Fund the non-authority account
      const airdropSig = await provider.connection.requestAirdrop(
        nonAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
      
      // Create new mint owned by non-authority
      const newTokenMint = await createMint(
        provider.connection,
        nonAuthority,
        nonAuthority.publicKey,
        null,
        9
      );
      
      // Same-token enforcement: reward mint = token mint
      const newRewardMint = newTokenMint;
      
      const [poolIdCounter] = derivePoolIdCounterPda(newTokenMint);
      const [pool] = derivePoolPda(newTokenMint, 0);
      const [rewardVault] = deriveRewardVaultPda(pool, newRewardMint);
      const programData = getProgramDataAddress();
      
      try {
        await program.methods
          .createPool(null, new BN(1000), new BN(0))
          .accounts({
            poolIdCounter,
            pool,
            tokenMint: newTokenMint,
            rewardMint: newRewardMint,
            rewardVault,
            admin: nonAuthority.publicKey,
            config: getGlobalConfigPDA(program.programId)[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([nonAuthority])
          .rpc();
        
        expect.fail("Should have thrown UnauthorizedPoolCreator error");
      } catch (err: any) {
        // Could be UnauthorizedPoolCreator or a constraint failure
        const errorMsg = err.error?.errorCode?.code || err.message || "";
        expect(
          errorMsg.includes("UnauthorizedPoolCreator") || 
          errorMsg.includes("Unauthorized") ||
          errorMsg.includes("ConstraintRaw")
        ).to.be.true;
        console.log("✅ Correctly rejected non-authority pool creation");
      }
    });
  });

  describe(" transfer_admin", () => {
    it("✅ Admin can transfer admin rights to new address", async () => {
      // Create a new keypair to be the new admin
      const newAdmin = Keypair.generate();
      const [configPda] = getGlobalConfigPDA(program.programId);
      
      // Get current admin
      const configBefore = await program.account.globalConfig.fetch(configPda);
      expect(configBefore.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      
      // Transfer admin to new address
      await program.methods
        .transferAdmin(newAdmin.publicKey)
        .accounts({
          config: configPda,
          admin: admin.publicKey,
        })
        .rpc();
      
      // Verify transfer
      const configAfter = await program.account.globalConfig.fetch(configPda);
      expect(configAfter.admin.toBase58()).to.equal(newAdmin.publicKey.toBase58());
      console.log("✅ Admin transferred to:", newAdmin.publicKey.toBase58());
      
      // Transfer back to original admin for other tests
      await provider.connection.requestAirdrop(newAdmin.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop
      
      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({
          config: configPda,
          admin: newAdmin.publicKey,
        })
        .signers([newAdmin])
        .rpc();
      
      const configRestored = await program.account.globalConfig.fetch(configPda);
      expect(configRestored.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      console.log("✅ Admin transferred back to original");
    });

    it("🚫 Non-admin cannot transfer admin rights", async () => {
      const nonAdmin = Keypair.generate();
      const newAdmin = Keypair.generate();
      const [configPda] = getGlobalConfigPDA(program.programId);
      
      // Fund non-admin
      await provider.connection.requestAirdrop(nonAdmin.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        await program.methods
          .transferAdmin(newAdmin.publicKey)
          .accounts({
            config: configPda,
            admin: nonAdmin.publicKey,
          })
          .signers([nonAdmin])
          .rpc();
        
        expect.fail("Should have thrown UnauthorizedPoolCreator error");
      } catch (err: any) {
        const errorMsg = err.error?.errorCode?.code || err.message || "";
        expect(
          errorMsg.includes("UnauthorizedPoolCreator") ||
          errorMsg.includes("Unauthorized") ||
          errorMsg.includes("Constraint")
        ).to.be.true;
        console.log("✅ Non-admin correctly rejected from transferring admin");
      }
    });

    it("🚫 Cannot transfer admin to default/zero address", async () => {
      const [configPda] = getGlobalConfigPDA(program.programId);
      
      try {
        await program.methods
          .transferAdmin(PublicKey.default)
          .accounts({
            config: configPda,
            admin: admin.publicKey,
          })
          .rpc();
        
        expect.fail("Should have thrown InvalidAuthorityAddress error");
      } catch (err: any) {
        const errorMsg = err.error?.errorCode?.code || err.message || "";
        expect(
          errorMsg.includes("InvalidAuthorityAddress") ||
          errorMsg.includes("Invalid")
        ).to.be.true;
        console.log("✅ Correctly rejected transfer to zero address");
      }
    });
  });

  describe(" Canonical ATA Enforcement", () => {
    let testPool: PublicKey;
    let testRewardMint: PublicKey;
    let testTokenMint: PublicKey;
    
    before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

      // Create a fresh pool for this test
      testTokenMint = await createMint(
        provider.connection,
        admin,
        admin.publicKey,
        null,
        9
      );
      
      // Same-token enforcement
      testRewardMint = testTokenMint;
      
      const [poolIdCounter] = derivePoolIdCounterPda(testTokenMint);
      [testPool] = derivePoolPda(testTokenMint, 0);
      const [rewardVault] = deriveRewardVaultPda(testPool, testRewardMint);
      const programData = getProgramDataAddress();
      
      await program.methods
        .createPool(null, new BN(1000), new BN(0))
        .accounts({
          poolIdCounter,
          pool: testPool,
          tokenMint: testTokenMint,
          rewardMint: testRewardMint,
          rewardVault,
          admin: admin.publicKey,
          config: getGlobalConfigPDA(program.programId)[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    });

    it("🚫 Rejects deposit_reward with non-canonical ATA", async () => {
      // Create a non-canonical (random) token account
      const randomTokenAccount = Keypair.generate();
      
      await createAccount(
        provider.connection,
        admin,
        testRewardMint,
        admin.publicKey,
        randomTokenAccount
      );
      
      // Mint some tokens to the random account
      await mintTo(
        provider.connection,
        admin,
        testRewardMint,
        randomTokenAccount.publicKey,
        admin,
        1000000
      );
      
      const [rewardVault] = deriveRewardVaultPda(testPool, testRewardMint);
      
      try {
        await program.methods
          .depositReward(new BN(0), new BN(100000))
          .accounts({
            pool: testPool,
            admin: admin.publicKey,
            tokenMint: testTokenMint,
            adminRewardAccount: randomTokenAccount.publicKey,
            rewardVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        expect.fail("Should have thrown NonCanonicalAta error");
      } catch (err: any) {
        const errorMsg = err.error?.errorCode?.code || err.message || "";
        expect(
          errorMsg.includes("NonCanonicalAta") ||
          errorMsg.includes("ConstraintRaw")
        ).to.be.true;
        console.log("✅ Correctly rejected non-canonical ATA for deposit_reward");
      }
    });

    it("✅ Accepts deposit_reward with canonical ATA", async () => {
      // Get the canonical ATA
      const canonicalAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        testRewardMint,
        admin.publicKey
      );
      
      // Mint tokens to the canonical ATA
      await mintTo(
        provider.connection,
        admin,
        testRewardMint,
        canonicalAta.address,
        admin,
        1000000
      );
      
      const [rewardVault] = deriveRewardVaultPda(testPool, testRewardMint);
      
      await program.methods
        .depositReward(new BN(0), new BN(100000))
        .accounts({
          pool: testPool,
          admin: admin.publicKey,
          tokenMint: testTokenMint,
          adminRewardAccount: canonicalAta.address,
          rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      console.log("✅ deposit_reward accepted with canonical ATA");
    });
  });
});
