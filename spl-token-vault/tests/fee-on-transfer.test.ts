import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  initializeTestEnvironment,
  createTestTokenMint,
  deriveVaultStatePda,
  getVaultTokenAccount,
} from "./helpers/setup-utils";
import { getEventsFromTransaction } from "./helpers/utils";

describe("🔄 SPL Token Vault - Fee-on-Transfer Token Support", () => {
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
  });

  it("✅ Records actual received amount for standard tokens", async () => {
    const orderId = "fee-test-standard-" + Date.now();
    const requestedAmount = new anchor.BN(1_000_000_000); // 1000 tokens

    // Get vault balance before deposit
    const vaultAccountBefore = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceBefore = vaultAccountBefore.amount;

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

    // Make deposit
    const tx = await program.methods
      .deposit(orderId, requestedAmount)
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

    // Get vault balance after deposit
    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceAfter = vaultAccountAfter.amount;

    // Calculate actual received amount
    const actualReceived = balanceAfter - balanceBefore;

    // Verify deposit record contains actual received amount
    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );

    expect(depositRecord.amount.toString()).to.equal(
      actualReceived.toString(),
      "Deposit record should contain actual received amount"
    );

    // For standard tokens, actual received should equal requested
    expect(actualReceived.toString()).to.equal(
      requestedAmount.toString(),
      "For standard tokens, received should equal requested"
    );
  });

  it("✅ DepositEvent emits actual received amount", async () => {
    const orderId = "fee-test-event-" + Date.now();
    const requestedAmount = new anchor.BN(500_000_000); // 500 tokens

    // Get vault balance before deposit
    const vaultAccountBefore = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceBefore = vaultAccountBefore.amount;

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

    // Make deposit
    const tx = await program.methods
      .deposit(orderId, requestedAmount)
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

    // Get vault balance after deposit
    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceAfter = vaultAccountAfter.amount;

    // Calculate actual received amount
    const actualReceived = balanceAfter - balanceBefore;

    // Get transaction details and events
    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const depositEvent = events.find((e) => e.name === "depositEvent");

    expect(depositEvent).to.not.be.undefined;
    expect(depositEvent.data.amount.toString()).to.equal(
      actualReceived.toString(),
      "DepositEvent should contain actual received amount"
    );
  });

  it("✅ check_deposit returns actual received amount", async () => {
    const orderId = "fee-test-check-" + Date.now();
    const requestedAmount = new anchor.BN(250_000_000); // 250 tokens

    // Get vault balance before deposit
    const vaultAccountBefore = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceBefore = vaultAccountBefore.amount;

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

    // Make deposit
    await program.methods
      .deposit(orderId, requestedAmount)
      .accounts({
        user: authority.publicKey,
        userTokenAccount: userTokenAccount,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        depositRecord: depositRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Get vault balance after deposit
    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const balanceAfter = vaultAccountAfter.amount;

    // Calculate actual received amount
    const actualReceived = balanceAfter - balanceBefore;

    // Check deposit using check_deposit method
    const checkedRecord = await program.methods
      .checkDeposit(orderId)
      .accounts({
        depositRecord: depositRecordPda,
        tokenMint: tokenMint,
        depositor: authority.publicKey,
      })
      .view();

    expect(checkedRecord.amount.toString()).to.equal(
      actualReceived.toString(),
      "check_deposit should return actual received amount"
    );
  });

  it("✅ Multiple deposits accumulate correctly", async () => {
    // Get initial vault balance
    const vaultAccountInitial = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const initialBalance = vaultAccountInitial.amount;

    // Use counter for unique order IDs instead of timestamp
    const testRunId = Date.now();
    const deposits = [
      { orderId: `fee-test-multi-1-${testRunId}`, amount: 100_000_000 },
      { orderId: `fee-test-multi-2-${testRunId}`, amount: 200_000_000 },
      { orderId: `fee-test-multi-3-${testRunId}`, amount: 300_000_000 },
    ];

    let totalActualReceived = BigInt(0);

    for (const deposit of deposits) {
      const orderId = deposit.orderId;
      const requestedAmount = new anchor.BN(deposit.amount);

      const vaultAccountBefore = await getAccount(
        provider.connection,
        vaultTokenAccount
      );
      const balanceBefore = vaultAccountBefore.amount;

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
        .deposit(orderId, requestedAmount)
        .accounts({
          user: authority.publicKey,
          userTokenAccount: userTokenAccount,
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          depositRecord: depositRecordPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultAccountAfter = await getAccount(
        provider.connection,
        vaultTokenAccount
      );
      const balanceAfter = vaultAccountAfter.amount;
      const actualReceived = balanceAfter - balanceBefore;

      totalActualReceived += actualReceived;

      // Verify deposit record
      const record = await program.account.depositRecord.fetch(
        depositRecordPda
      );
      expect(record.amount.toString()).to.equal(actualReceived.toString());
    }

    // Verify total vault balance
    const vaultAccountFinal = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const finalBalance = vaultAccountFinal.amount;
    const totalIncrease = finalBalance - initialBalance;

    expect(totalIncrease.toString()).to.equal(
      totalActualReceived.toString(),
      "Total vault increase should match sum of actual received amounts"
    );
  });
});
