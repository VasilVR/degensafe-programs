import * as anchor from "@coral-xyz/anchor";
import { Program, BN, EventParser } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { StakeProgram } from "../target/types/stake_program";
import { getTestEnvironment , getGlobalConfigPDA, initializeGlobalConfig } from "./test-utils";

describe("🎉 Stake Program - Events", () => {
  const { provider, program, admin } = getTestEnvironment();
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let poolPda: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userTokenAccount: anchor.web3.PublicKey;
  let userRewardAccount: anchor.web3.PublicKey;
  const poolId = new BN(0); // Define at module level for reuse across tests

  // Helper function to parse events from transaction
  const getEventsFromTransaction = (txDetails: any) => {
    if (!txDetails || !txDetails.meta || !txDetails.meta.logMessages) {
      return [];
    }
    const eventParser = new EventParser(program.programId, program.coder);
    // parseLogs returns a generator, so we need to convert it to an array
    return Array.from(eventParser.parseLogs(txDetails.meta.logMessages));
  };

  before(async () => {
    // Initialize global config
    await initializeGlobalConfig(program, admin);

    // Create user keypair
    user = anchor.web3.Keypair.generate();

    // Airdrop SOL to user
    const signature = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Create token mints
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

    // Derive pool PDA with pool_id
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    console.log("✅ Setup complete");
  });

  it("1. ✅ PoolCreatedEvent emitted on pool creation", async () => {
    const rewardPercentage = 100; // 1.00% APY in basis points

    const tx = await program.methods
      .createPool(null, new BN(rewardPercentage), poolId)
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
        config: getGlobalConfigPDA(program.programId)[0],
      })
      .rpc();

    // Wait for confirmation
    await provider.connection.confirmTransaction(tx, "confirmed");

    // Fetch transaction to get events
    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    expect(txDetails).to.not.be.null;

    // Parse events from transaction
    const events = getEventsFromTransaction(txDetails);
    const poolCreatedEvent = events.find((e) => e.name === "poolCreatedEvent");

    expect(poolCreatedEvent).to.not.be.undefined;
    expect(poolCreatedEvent.data.pool.toString()).to.equal(poolPda.toString());
    expect(poolCreatedEvent.data.tokenMint.toString()).to.equal(
      tokenMint.toString()
    );
    expect(poolCreatedEvent.data.rewardMint.toString()).to.equal(
      rewardMint.toString()
    );
    console.log("✅ PoolCreatedEvent emitted with correct data");
  });

  it("2. ✅ PoolStakingActiveChangedEvent emitted when toggling pool status", async () => {
    const tx = await program.methods
      .setStakingActive(poolId, false)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find(
      (e) => e.name === "poolStakingActiveChangedEvent"
    );

    expect(event).to.not.be.undefined;
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.isActive).to.equal(false);
    console.log("✅ PoolStakingActiveChangedEvent emitted with correct data");

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

  it("3. ✅ PoolRewardPercentageUpdatedEvent emitted on percentage update", async () => {
    const newPercentage = 200; // 200% APY

    const tx = await program.methods
      .updateRewardPercentage(poolId, new BN(newPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find(
      (e) => e.name === "poolRewardPercentageUpdatedEvent"
    );

    expect(event).to.not.be.undefined;
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.newPercentage.toNumber()).to.equal(newPercentage);
    console.log(
      "✅ PoolRewardPercentageUpdatedEvent emitted with correct data"
    );
  });

  it("4. ✅ RewardDepositedEvent emitted when admin deposits rewards", async () => {
    // Create admin reward account and mint tokens
    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.payer,
      1_000_000_000 // 1000 tokens
    );

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .depositReward(poolId, new BN(500_000_000)) // 500 tokens
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find((e) => e.name === "rewardDepositedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.amount.toNumber()).to.equal(500_000_000);
    console.log("✅ RewardDepositedEvent emitted with correct data");
  });

  it("5. ✅ StakeDepositedEvent emitted when user stakes tokens", async () => {
    // Create user token account and mint tokens
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      user.publicKey
    );
    userTokenAccount = userTokenAccountInfo.address;

    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount,
      admin.payer,
      1_000_000_000 // 1000 tokens
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

    const tx = await program.methods
      .depositStake(poolId, new BN(100_000_000)) // 100 tokens
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find((e) => e.name === "stakeDepositedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.user.toString()).to.equal(user.publicKey.toString());
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.amount.toNumber()).to.equal(100_000_000);
    console.log("✅ StakeDepositedEvent emitted with correct data");
  });

  it("6. ✅ RewardClaimedEvent emitted when user claims rewards", async () => {
    // Temporarily increase APY for testing purposes to ensure rewards accrue quickly
    const testHighApy = 1_000_000; // 10,000% for test purposes
    await program.methods
      .updateRewardPercentage(poolId, new BN(testHighApy))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Wait a bit for rewards to accrue
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create user reward account
    const userRewardAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      user.publicKey
    );
    userRewardAccount = userRewardAccountInfo.address;

    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_stake"),
        poolPda.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .claimReward(poolId)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userRewardAccount: userRewardAccount,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find((e) => e.name === "rewardClaimedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.user.toString()).to.equal(user.publicKey.toString());
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.amount.toNumber()).to.be.greaterThan(0);
    console.log("✅ RewardClaimedEvent emitted with correct data");
  });

  it("7. ✅ StakeWithdrawnEvent emitted when user withdraws stake", async () => {
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

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .withdrawStake(poolId, new BN(50_000_000)) // 50 tokens
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userRewardAccount: userRewardAccount,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .signers([user])
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find((e) => e.name === "stakeWithdrawnEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.user.toString()).to.equal(user.publicKey.toString());
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.amount.toNumber()).to.equal(50_000_000);
    console.log("✅ StakeWithdrawnEvent emitted with correct data");
  });

  it("8. ✅ RewardWithdrawnEvent emitted when admin withdraws rewards", async () => {
    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), poolPda.toBuffer(), rewardMint.toBuffer()],
      program.programId
    );

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    const tx = await program.methods
      .withdrawReward(poolId, new BN(100_000_000)) // 100 tokens
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(txDetails);
    const event = events.find((e) => e.name === "rewardWithdrawnEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.pool.toString()).to.equal(poolPda.toString());
    expect(event.data.amount.toNumber()).to.equal(100_000_000);
    console.log("✅ RewardWithdrawnEvent emitted with correct data");
  });
});
