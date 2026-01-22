import * as anchor from "@coral-xyz/anchor";
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
import { getEventsFromTransaction } from "./helpers/utils";

describe("🎉 SPL Token Vault Program - Transactions", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;

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

    console.log("✅ Setup complete");
  });

  it("✅ DepositEvent emitted when depositing tokens", async () => {
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
      1_000_000_000 // 1000 tokens
    );

    const orderId = "test-order-" + Date.now();
    const depositAmount = new anchor.BN(500_000_000); // 500 tokens

    // Create deposit record PDA
    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        tokenMint.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    const tx = await program.methods
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

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "depositEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.user.toString()).to.equal(authority.publicKey.toString());
    expect(event.data.orderId).to.equal(orderId);
    expect(event.data.amount.toNumber()).to.equal(depositAmount.toNumber());
    console.log("✅ DepositEvent emitted with correct data");
  });

  it("✅ Deposit creates record with correct data", async () => {
    const orderId = "test-order-2-" + Date.now();
    const depositAmount = new anchor.BN(100_000_000); // 100 tokens

    // Create deposit record PDA
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

    // Verify deposit record
    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.user.toString()).to.equal(
      authority.publicKey.toString()
    );
    expect(depositRecord.orderId).to.equal(orderId);
    expect(depositRecord.amount.toNumber()).to.equal(depositAmount.toNumber());

    console.log("✅ Deposit record created with correct data");
  });

  it("✅ Checks vault balance successfully", async () => {
    await program.methods
      .check()
      .accounts({
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
      })
      .rpc();

    console.log("✅ Vault check ran successfully");
  });
});
