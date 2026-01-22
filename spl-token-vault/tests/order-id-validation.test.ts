import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  initializeTestEnvironment,
  createTestTokenMint,
  deriveVaultStatePda,
  getVaultTokenAccount,
} from "./helpers/setup-utils";

describe("spl_token_vault_program - Order ID Validation", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;
  let testCounter = 0;

  before(async () => {
    // Create token mint
    tokenMint = await createTestTokenMint(provider, authority);

    // Derive vault state PDA
    [vaultStatePda] = deriveVaultStatePda(tokenMint, program.programId);

    // Initialize vault
    await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    // Get vault token account
    vaultTokenAccount = await getVaultTokenAccount(tokenMint, vaultStatePda);

    // Create user token account and mint tokens
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tokenMint,
      authority.publicKey
    );
    userTokenAccount = userTokenAccountInfo.address;

    await mintTo(
      provider.connection,
      authority.payer,
      tokenMint,
      userTokenAccount,
      authority.payer,
      10_000_000_000 // 10,000 tokens
    );

    console.log("✅ Setup complete");
  });

  it("Fails to deposit with empty order_id", async () => {
    const orderId = "";
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        tokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    try {
      await program.methods
        .deposit(orderId, depositAmount)
        .accounts({
          user: authority.publicKey,
          userTokenAccount: userTokenAccount,
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          depositRecord: depositRecordPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      throw new Error("Expected deposit to fail for empty order_id");
    } catch (err: any) {
      expect(err.toString()).to.include("OrderIdEmpty");
    }
  });

  it("Fails to deposit with order_id exceeding 32 bytes", async () => {
    // Create an order_id that exceeds 32 bytes
    const orderId = "a".repeat(33);
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    try {
      // PDA derivation will fail before reaching the custom validation
      const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("deposit_record"),
          tokenMint.toBuffer(),
          authority.publicKey.toBuffer(),
          Buffer.from(orderId),
        ],
        program.programId
      );

      await program.methods
        .deposit(orderId, depositAmount)
        .accounts({
          user: authority.publicKey,
          userTokenAccount: userTokenAccount,
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          depositRecord: depositRecordPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      throw new Error("Expected deposit to fail for order_id exceeding 32 bytes");
    } catch (err: any) {
      // Expect TypeError from PDA derivation, not custom error
      expect(err.toString()).to.match(/(TypeError|Max seed length|exceeded)/i);
    }
  });

  it("Successfully deposits with valid order_id (1 byte)", async () => {
    const orderId = "a";
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        tokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        user: authority.publicKey,
        userTokenAccount: userTokenAccount,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        depositRecord: depositRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });

  it("Successfully deposits with valid order_id (32 bytes)", async () => {
    const orderId = "b".repeat(32);
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        tokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        user: authority.publicKey,
        userTokenAccount: userTokenAccount,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        depositRecord: depositRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });

  it("Successfully deposits with typical order_id format", async () => {
    const orderId = "order-" + (++testCounter);
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        tokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        user: authority.publicKey,
        userTokenAccount: userTokenAccount,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        depositRecord: depositRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });
});
