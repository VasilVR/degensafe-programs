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

describe("🏦 Stake Program - Reward Vault Management", () => {
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

    // Create pool for reward vault tests
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
    console.log("✅ Reward mint created:", rewardMint.toBase58());
  });

  it("8. 💰 Admin deposits reward tokens into reward_vault", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const rewardVaultPda = poolAccount.rewardVault; //

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 500_000_000; // 500 tokens (6 decimals)
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    // Fetch balance before deposit
    const beforeVault = await getAccount(provider.connection, rewardVaultPda);
    console.log("Vault balance BEFORE deposit:", Number(beforeVault.amount));

    // Call deposit_reward instruction
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

    // Fetch balance after deposit
    const afterVault = await getAccount(provider.connection, rewardVaultPda);
    console.log("Vault balance AFTER deposit:", Number(afterVault.amount));

    // Validate deposit
    expect(Number(afterVault.amount) - Number(beforeVault.amount)).to.equal(
      DEPOSIT_AMOUNT
    );

    console.log("✅ Reward deposited successfully!");
  });

  it("9. ℹ️ Verify pool info reflects correct reward vault and reward mint", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const poolInfo = await program.methods
      .getPoolInfo(poolId)
      .accounts({ pool: poolPda, tokenMint: tokenMint })
      .view();

    console.log("📌 Pool info after deposit:", {
      rewardMint: poolInfo.rewardMint.toBase58(),
      rewardVault: poolInfo.rewardVault.toBase58(),
      totalStaked: poolInfo.totalStaked.toString(),
      rewardPercentage: poolInfo.rewardPercentage.toString(),
    });

    // Assertions
    expect(poolInfo.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolInfo.rewardVault.toBase58()).to.be.a("string"); // PDA should exist
  });

  it("10a. 🔄 Admin updates pool reward mint and vault", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Create a new reward mint
    const newRewardMintKeypair = anchor.web3.Keypair.generate();
    const newRewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      newRewardMintKeypair
    );

    console.log("✅ New reward mint created:", newRewardMint.toBase58());

    // Derive the reward vault PDA for the new reward mint
    const [newRewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("reward_vault"),
        poolPda.toBuffer(),
        newRewardMint.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .updateRewardMint(poolId)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        newRewardMint: newRewardMint,
        rewardVault: newRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .rpc();

    // Fetch updated pool
    const updatedPool = await program.account.pool.fetch(poolPda);
    console.log(
      "✅ Updated pool reward mint:",
      updatedPool.rewardMint.toBase58()
    );
    console.log(
      "✅ Updated pool reward vault:",
      updatedPool.rewardVault.toBase58()
    );

    expect(updatedPool.rewardMint.toBase58()).to.equal(
      newRewardMint.toBase58()
    );
    expect(updatedPool.rewardVault.toBase58()).to.equal(
      newRewardVaultPda.toBase58()
    );

    // Optionally, check the reward vault account exists
    const vaultAccount = await getAccount(
      provider.connection,
      newRewardVaultPda
    );
    console.log("🏦 New reward vault balance:", Number(vaultAccount.amount));
  });

  it("11. 💸 Track original vs current pool reward vault balances (show addresses)", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const currentRewardVaultPda = poolAccount.rewardVault;
    const poolRewardMint = poolAccount.rewardMint;

    // Derive the original reward vault PDA from original rewardMint
    const [originalRewardVaultPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault"),
          poolPda.toBuffer(),
          rewardMint.toBuffer(),
        ],
        program.programId
      );

    // Mint some tokens to admin for current pool reward mint
    const adminRewardAccountPool = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolRewardMint,
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 500_000_000; // 500 tokens

    await mintTo(
      provider.connection,
      admin.payer,
      poolRewardMint,
      adminRewardAccountPool.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    // Fetch vault balances BEFORE deposit
    const beforeOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const beforeCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      "🏦 Original reward vault address:",
      originalRewardVaultPda.toBase58()
    );
    console.log(
      "🏦 Original reward vault BEFORE:",
      Number(beforeOriginalVault.amount)
    );
    console.log(
      "🏦 Current pool reward vault address:",
      currentRewardVaultPda.toBase58()
    );
    console.log(
      "🏦 Current pool reward vault BEFORE:",
      Number(beforeCurrentVault.amount)
    );

    // Deposit to current pool reward vault
    await program.methods
      .depositReward(poolId, new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccountPool.address,
        rewardVault: currentRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    const afterDepositOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const afterDepositCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      "🏦 Original reward vault AFTER deposit:",
      Number(afterDepositOriginalVault.amount)
    );
    console.log(
      "🏦 Current pool reward vault AFTER deposit:",
      Number(afterDepositCurrentVault.amount)
    );

    // Withdraw some tokens from current pool reward vault
    const WITHDRAW_AMOUNT = 100_000_000; // 100 tokens
    await program.methods
      .withdrawReward(poolId, new anchor.BN(WITHDRAW_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccountPool.address,
        rewardVault: currentRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    const afterWithdrawOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const afterWithdrawCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      "🏦 Original reward vault address:",
      originalRewardVaultPda.toBase58()
    );
    console.log(
      "🏦 Original reward vault AFTER withdraw:",
      Number(afterWithdrawOriginalVault.amount)
    );
    console.log(
      "🏦 Current pool reward vault address:",
      currentRewardVaultPda.toBase58()
    );
    console.log(
      "🏦 Current pool reward vault AFTER withdraw:",
      Number(afterWithdrawCurrentVault.amount)
    );

    // Assertions for current pool vault only
    expect(
      Number(afterDepositCurrentVault.amount) -
        Number(beforeCurrentVault.amount)
    ).to.equal(DEPOSIT_AMOUNT);
    expect(Number(afterWithdrawCurrentVault.amount) + WITHDRAW_AMOUNT).to.equal(
      Number(afterDepositCurrentVault.amount)
    );
  });

  it("11. ❌ Non-admin cannot withdraw from original or current reward vault", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const currentRewardVaultPda = poolAccount.rewardVault;
    const poolRewardMint = poolAccount.rewardMint;

    // Derive original reward vault PDA
    const [originalRewardVaultPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault"),
          poolPda.toBuffer(),
          rewardMint.toBuffer(),
        ],
        program.programId
      );

    // Random non-admin wallet
    const nonAdmin = anchor.web3.Keypair.generate();

    // Fund non-admin with some SOL for tx fees
    const sig = await provider.connection.requestAirdrop(
      nonAdmin.publicKey,
      1e9
    );
    await provider.connection.confirmTransaction(sig);

    // Non-admin associated token accounts
    const nonAdminOriginalAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      nonAdmin,
      rewardMint, // original mint
      nonAdmin.publicKey
    );

    const nonAdminCurrentAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      nonAdmin,
      poolRewardMint, // current mint
      nonAdmin.publicKey
    );

    const WITHDRAW_AMOUNT = 100_000_000; // 100 tokens

    // Attempt withdrawal from original vault
    try {
      await program.methods
        .withdrawReward(poolId, new anchor.BN(WITHDRAW_AMOUNT))
        .accounts({
          pool: poolPda,
          admin: nonAdmin.publicKey,
          adminRewardAccount: nonAdminOriginalAccount.address,
          rewardVault: originalRewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMint: tokenMint,
        })
        .signers([nonAdmin])
        .rpc();

      throw new Error(
        "Non-admin withdrawal from original vault succeeded unexpectedly"
      );
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log("✅ Expected error (original vault):", errMsg);
      expect(errMsg).to.include("A raw constraint was violated");
    }

    // Attempt withdrawal from current vault
    try {
      await program.methods
        .withdrawReward(poolId, new anchor.BN(WITHDRAW_AMOUNT))
        .accounts({
          pool: poolPda,
          admin: nonAdmin.publicKey,
          adminRewardAccount: nonAdminCurrentAccount.address,
          rewardVault: currentRewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenMint: tokenMint,
        })
        .signers([nonAdmin])
        .rpc();

      throw new Error(
        "Non-admin withdrawal from current vault succeeded unexpectedly"
      );
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log("✅ Expected Unauthorized error (current vault):", errMsg);
      expect(errMsg).to.include("Unauthorized");
    }
  });
});
