import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";

describe("vault_program", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.VaultProgram as Program;
  const wallet = provider.wallet as anchor.Wallet;

  // PDAs and keys
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let vaultBump: number;
  let stateBump: number;

  before(async () => {
    [vaultStatePda, stateBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state")],
      program.programId
    );

    [vaultPda, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_pda")],
      program.programId
    );
  });

  it("Initialize vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.authority.toBase58()).to.eq(wallet.publicKey.toBase58());
    expect(vaultState.balance.toNumber()).to.eq(0);
  });

  it("Deposit SOL into vault", async () => {
    const orderId = "order123";
    const amountLamports = 0.1 * anchor.web3.LAMPORTS_PER_SOL;

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), Buffer.from(orderId)],
      program.programId
    );

    await program.methods
      .deposit(orderId, new anchor.BN(amountLamports))
      .accounts({
        depositor: wallet.publicKey,
        vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.balance.toNumber()).to.be.greaterThan(0);

    const record = await program.account.depositRecord.fetch(depositRecordPda);
    expect(record.orderId).to.eq(orderId);
    expect(record.user.toBase58()).to.eq(wallet.publicKey.toBase58());
  });

  it("Check deposit record", async () => {
    const orderId = "order123";
    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), Buffer.from(orderId)],
      program.programId
    );

    const record = await program.account.depositRecord.fetch(depositRecordPda);
    expect(record.orderId).to.eq(orderId);
  });

  it("Set withdrawal wallet", async () => {
    const newWallet = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .setWithdrawalAccount(newWallet)
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toBase58()).to.eq(newWallet.toBase58());
  });

  it("Withdraw all funds", async () => {
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    const walletAccount = vaultState.walletAccount;

    await program.methods
      .withdraw()
      .accounts({
        vaultState: vaultStatePda,
        vaultPda,
        walletAccount,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const updated = await program.account.vaultState.fetch(vaultStatePda);
    expect(updated.balance.toNumber()).to.eq(0);
  });

  // ------------------ NEW NEGATIVE TESTS ------------------

  it("Fails if non-admin tries to set withdrawal wallet", async () => {
    const attacker = anchor.web3.Keypair.generate();
    const newWallet = anchor.web3.Keypair.generate().publicKey;

    try {
await program.methods
    .setWithdrawalAccount(newWallet)
    .accounts({
      vaultState: vaultStatePda,
      authority: attacker.publicKey,
    })
    .signers([attacker])
    .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for non-admin");
    } catch (err: any) {
  expect(err.toString()).to.include("ConstraintHasOne");
    }
  });

 it("Fails if non-admin tries to withdraw funds", async () => {
  const attacker = anchor.web3.Keypair.generate();
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const walletAccount = vaultState.walletAccount;

  try {
    await program.methods
      .withdraw()
      .accounts({
        vaultState: vaultStatePda,
        vaultPda,
        walletAccount,
        authority: attacker.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([attacker])
      .rpc();

    // If it succeeds, fail the test
    throw new Error("Expected withdraw to fail for non-admin");
  } catch (err: any) {
    // Check actual Anchor error code
    expect(err.toString()).to.include("ConstraintHasOne");
  }
});
});
