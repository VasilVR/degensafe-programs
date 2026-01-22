import anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";

describe("sol_vault_program - Order ID Validation", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolVaultProgram as Program;
  const wallet = provider.wallet as anchor.Wallet;

  let vaultStatePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let testCounter = 0;

  before(async () => {
    [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state")],
      program.programId
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_pda")],
      program.programId
    );

    // Ensure vault is initialized
    try {
      await program.account.vaultState.fetch(vaultStatePda);
    } catch (err) {
      await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }
  });

  it("Fails to deposit with empty order_id", async () => {
    const orderId = "";
    const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        wallet.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    try {
      await program.methods
        .deposit(orderId, depositAmount)
        .accounts({
          depositor: wallet.publicKey,
          vaultPda: vaultPda,
          vaultState: vaultStatePda,
          depositRecord: depositRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
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
    const depositAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);

    try {
      // PDA derivation will fail before reaching the custom validation
      const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("deposit_record"),
          wallet.publicKey.toBuffer(),
          Buffer.from(orderId),
        ],
        program.programId
      );

      await program.methods
        .deposit(orderId, depositAmount)
        .accounts({
          depositor: wallet.publicKey,
          vaultPda: vaultPda,
          vaultState: vaultStatePda,
          depositRecord: depositRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
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
    const depositAmount = new anchor.BN(0.1 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        wallet.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: wallet.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });

  it("Successfully deposits with valid order_id (32 bytes)", async () => {
    const orderId = "b".repeat(32);
    const depositAmount = new anchor.BN(0.1 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        wallet.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: wallet.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });

  it("Successfully deposits with typical order_id format", async () => {
    const orderId = "order-" + (++testCounter);
    const depositAmount = new anchor.BN(0.1 * anchor.web3.LAMPORTS_PER_SOL);

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit_record"),
        wallet.publicKey.toBuffer(),
        Buffer.from(orderId),
      ],
      program.programId
    );

    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        depositor: wallet.publicKey,
        vaultPda: vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const depositRecord = await program.account.depositRecord.fetch(
      depositRecordPda
    );
    expect(depositRecord.orderId).to.equal(orderId);
  });
});
