import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getTestEnvironment,
  getVaultStatePda,
  getVaultPda,
  getDepositRecordPda,
  getEventsFromTransaction,
  ensureVaultInitialized,
} from "../helpers/utils";

describe("🎉 SOL Vault Program - Withdrawal Events", () => {
  const { provider, program, authority } = getTestEnvironment();

  let vaultStatePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let withdrawalWallet: anchor.web3.Keypair;

  before(async () => {
    // Derive PDAs
    [vaultStatePda] = getVaultStatePda(program.programId);
    [vaultPda] = getVaultPda(program.programId);

    // Initialize vault if not already initialized
    await ensureVaultInitialized(program, vaultStatePda, authority.publicKey);

    withdrawalWallet = anchor.web3.Keypair.generate();

    // Airdrop SOL to withdrawal wallet
    const signature = await provider.connection.requestAirdrop(
      withdrawalWallet.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    console.log("✅ Setup complete");
  });

  it("✅ WithdrawalWalletUpdatedEvent emitted when setting withdrawal wallet", async () => {
    const tx = await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        newWallet: withdrawalWallet.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find(
      (e) => e.name === "withdrawalWalletUpdatedEvent"
    );

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(
      vaultStatePda.toString()
    );
    expect(event.data.newWallet.toString()).to.equal(
      withdrawalWallet.publicKey.toString()
    );
    console.log("✅ WithdrawalWalletUpdatedEvent emitted with correct data");
  });

  it("✅ DepositEvent emitted when depositing SOL", async () => {
    const orderId = "test-order-" + Date.now();
    const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = getDepositRecordPda(authority.publicKey, orderId, program.programId);

    const tx = await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: authority.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
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
    expect(event.data.depositor.toString()).to.equal(
      authority.publicKey.toString()
    );
    expect(event.data.orderId).to.equal(orderId);
    expect(event.data.amount.toNumber()).to.equal(depositAmount.toNumber());
    console.log("✅ DepositEvent emitted with correct data");
  });

  it("✅ WithdrawEvent emitted when withdrawing SOL", async () => {
    const tx = await program.methods
      .withdraw()
      .accounts({
        vaultState: vaultStatePda,
        vaultPda: vaultPda,
        authority: authority.publicKey,
      })
      .remainingAccounts([
        {
          pubkey: withdrawalWallet.publicKey,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "withdrawEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(
      vaultStatePda.toString()
    );
    expect(event.data.walletAccount.toString()).to.equal(
      withdrawalWallet.publicKey.toString()
    );
    console.log("✅ WithdrawEvent emitted with correct data");
  });

  it("✅ Multiple events can be emitted in sequence", async () => {
    // Make another deposit - use shorter order ID to avoid seed length limit
    const orderId = "seq-" + Date.now().toString().slice(-8);
    const depositAmount = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = getDepositRecordPda(authority.publicKey, orderId, program.programId);

    const depositTx = await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: authority.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
      })
      .rpc();

    await provider.connection.confirmTransaction(depositTx, "confirmed");

    const depositTxDetails = await provider.connection.getTransaction(
      depositTx,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }
    );

    const depositEvents = getEventsFromTransaction(program, depositTxDetails);
    const depositEvent = depositEvents.find((e) => e.name === "depositEvent");

    expect(depositEvent).to.not.be.undefined;

    // Now make a withdrawal
    const withdrawTx = await program.methods
      .withdraw()
      .accounts({
        vaultState: vaultStatePda,
        vaultPda: vaultPda,
        authority: authority.publicKey,
      })
      .remainingAccounts([
        {
          pubkey: withdrawalWallet.publicKey,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc();

    await provider.connection.confirmTransaction(withdrawTx, "confirmed");

    const withdrawTxDetails = await provider.connection.getTransaction(
      withdrawTx,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }
    );

    const withdrawEvents = getEventsFromTransaction(program, withdrawTxDetails);
    const withdrawEvent = withdrawEvents.find(
      (e) => e.name === "withdrawEvent"
    );

    expect(withdrawEvent).to.not.be.undefined;
    console.log("✅ Multiple events emitted successfully in sequence");
  });
});
