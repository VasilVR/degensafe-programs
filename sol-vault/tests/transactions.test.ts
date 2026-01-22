import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getTestEnvironment,
  getVaultStatePda,
  getVaultPda,
  getDepositRecordPda,
  ensureVaultInitialized,
} from "./helpers/utils";

describe("🎉 SOL Vault Program - Transactions", () => {
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

    // Set withdrawal account
    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        newWallet: withdrawalWallet.publicKey,
      })
      .rpc();

    console.log("✅ Setup complete");
  });

  it("✅ Can deposit SOL to vault", async () => {
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

    // Verify deposit record was created
    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.user.toString()).to.equal(
      authority.publicKey.toString()
    );
    expect(depositRecord.orderId).to.equal(orderId);
    expect(depositRecord.solAmount.toNumber()).to.equal(depositAmount.toNumber());
    console.log("✅ Deposit successful");
  });

  it("✅ Can withdraw SOL from vault", async () => {
    // First make a deposit
    const orderId = "withdraw-" + Date.now();
    const depositAmount = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);
    const [depositRecordPda] = getDepositRecordPda(authority.publicKey, orderId, program.programId);

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: authority.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
      })
      .rpc();

    const balanceBefore = await provider.connection.getBalance(
      withdrawalWallet.publicKey
    );

    // Now withdraw
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

    const balanceAfter = await provider.connection.getBalance(
      withdrawalWallet.publicKey
    );

    // Verify balance increased
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
    console.log("✅ Withdrawal successful");
  });

  it("✅ Multiple deposits can be made", async () => {
    const orderId1 = "multi-1-" + Date.now();
    const orderId2 = "multi-2-" + Date.now();
    const depositAmount = new anchor.BN(0.25 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda1] = getDepositRecordPda(
      authority.publicKey,
      orderId1,
      program.programId
    );
    const [depositRecordPda2] = getDepositRecordPda(
      authority.publicKey,
      orderId2,
      program.programId
    );

    // First deposit
    await program.methods
      .deposit(orderId1, depositAmount)
      .accounts({
        depositor: authority.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda1,
      })
      .rpc();

    // Second deposit
    await program.methods
      .deposit(orderId2, depositAmount)
      .accounts({
        depositor: authority.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda2,
      })
      .rpc();

    // Verify both deposit records exist
    const depositRecord1 = await program.account.depositRecord.fetch(
      depositRecordPda1
    );
    const depositRecord2 = await program.account.depositRecord.fetch(
      depositRecordPda2
    );

    expect(depositRecord1.orderId).to.equal(orderId1);
    expect(depositRecord2.orderId).to.equal(orderId2);
    console.log("✅ Multiple deposits successful");
  });
});
