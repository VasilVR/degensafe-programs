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
import { getTestEnvironment , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🧑‍💼 Stake Program - User Staking", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userTokenAccount: any;
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

    // Create pool for user staking tests
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
    console.log("✅ Reward mint = token mint (same-token):", rewardMint.toBase58());
  });

  it("13. 🧑‍💼 User deposits stake twice and check balances", async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Ensure pool is active
    await program.methods
      .setStakingActive(poolId, true)
      .accounts({ pool: poolPda, admin: admin.publicKey, tokenMint: tokenMint })
      .rpc();

    user = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000);

    // Create user's token account and mint tokens
    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      user.publicKey
    );

    // First deposit
    const FIRST_DEPOSIT = new anchor.BN(500_000_000);
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      FIRST_DEPOSIT.toNumber()
    );

    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    await program.methods
      .depositStake(poolId, FIRST_DEPOSIT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    const userStakeAccount1 = await program.account.userStake.fetch(
      userStakePda
    );
    console.log("📊 User stake info after 1st deposit:", {
      owner: userStakeAccount1.owner.toBase58(),
      pool: userStakeAccount1.pool.toBase58(),
      amount: userStakeAccount1.amount.toString(),
      totalEarned: userStakeAccount1.totalEarned.toString(),
      lastStakedSlot: (userStakeAccount1.lastStakedSlot as any).toString(),
    });

    // Second deposit
    const SECOND_DEPOSIT = new anchor.BN(300_000_000);
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      SECOND_DEPOSIT.toNumber()
    );

    await program.methods
      .depositStake(poolId, SECOND_DEPOSIT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    const userStakeAccount = await program.account.userStake.fetch(
      userStakePda
    );
    console.log("📊 User stake info after two deposits:", {
      owner: userStakeAccount.owner.toBase58(),
      pool: userStakeAccount.pool.toBase58(),
      amount: userStakeAccount.amount.toString(),
      totalEarned: userStakeAccount.totalEarned.toString(),
      lastStakedSlot: (userStakeAccount.lastStakedSlot as any).toString(),
    });

    expect(userStakeAccount.amount.toString()).to.equal(
      FIRST_DEPOSIT.add(SECOND_DEPOSIT).toString()
    );
  });
});
