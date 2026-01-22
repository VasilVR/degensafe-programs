import anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";

describe("sol_vault_program", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolVaultProgram as Program;
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
    // Check if vault is already initialized (e.g., by another test file)
    try {
      const existingVault = await program.account.vaultState.fetch(vaultStatePda);
      // Vault already exists, verify it's properly set up
      expect(existingVault.authority.toBase58()).to.eq(wallet.publicKey.toBase58());
      console.log("Vault already initialized, skipping initialization");
    } catch (err) {
      // Vault doesn't exist, initialize it
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
    }
  });

  it("Deposit SOL into vault", async () => {
    const orderId = "order123";
    const amountLamports = 0.1 * anchor.web3.LAMPORTS_PER_SOL;

    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), wallet.publicKey.toBuffer(), Buffer.from(orderId)],
      program.programId
    );

    // Get vault balance before deposit
    const vaultPdaBefore = await provider.connection.getAccountInfo(vaultPda);
    const balanceBefore = vaultPdaBefore?.lamports || 0;

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

    // Verify vault balance increased by deposit amount
    const vaultPdaAfter = await provider.connection.getAccountInfo(vaultPda);
    expect(vaultPdaAfter.lamports).to.eq(balanceBefore + amountLamports);

    const record = await program.account.depositRecord.fetch(depositRecordPda);
    expect(record.orderId).to.eq(orderId);
    expect(record.user.toBase58()).to.eq(wallet.publicKey.toBase58());
    expect(record.solAmount.toNumber()).to.eq(amountLamports);
  });

  it("Check deposit record", async () => {
    const orderId = "order123";
    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), wallet.publicKey.toBuffer(), Buffer.from(orderId)],
      program.programId
    );

    const record = await program.account.depositRecord.fetch(depositRecordPda);
    expect(record.orderId).to.eq(orderId);
  });

  it("Set withdrawal wallet", async () => {
    const newWallet = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        newWallet,
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
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: walletAccount,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc();

    // Verify withdrawal succeeded - vault PDA should still exist with rent-exempt balance
    const vaultPdaInfo = await provider.connection.getAccountInfo(vaultPda);
    expect(vaultPdaInfo).to.not.be.null;
    
    // After withdrawal, vault should only have rent-exempt minimum for its account
    const minimumRentExempt = await provider.connection.getMinimumBalanceForRentExemption(
      vaultPdaInfo.data.length
    );
    // Balance should be approximately the rent-exempt minimum
    expect(vaultPdaInfo.lamports).to.equal(minimumRentExempt);
  });

  // ------------------ NEW NEGATIVE TESTS ------------------

  it("Fails if non-admin tries to set withdrawal wallet", async () => {
    const attacker = anchor.web3.Keypair.generate();
    const newWallet = anchor.web3.Keypair.generate().publicKey;

    try {
await program.methods
    .setWithdrawalAccount()
    .accounts({
      vaultState: vaultStatePda,
      authority: attacker.publicKey,
      newWallet,
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
        authority: attacker.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: walletAccount,
          isSigner: false,
          isWritable: true,
        },
      ])
      .signers([attacker])
      .rpc();

    // If it succeeds, fail the test
    throw new Error("Expected withdraw to fail for non-admin");
  } catch (err: any) {
    // Check actual Anchor error code
    expect(err.toString()).to.include("ConstraintHasOne");
  }
});

  it("Fails if withdraw attempts to send to different wallet than configured", async () => {
    const wrongWallet = anchor.web3.Keypair.generate().publicKey;
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    
    // Verify that wrongWallet is different from configured wallet
    expect(wrongWallet.toBase58()).to.not.eq(vaultState.walletAccount.toBase58());

    try {
      await program.methods
        .withdraw()
        .accounts({
          vaultState: vaultStatePda,
          vaultPda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: wrongWallet,
            isSigner: false,
            isWritable: true,
          },
        ])
        .rpc();

      // If it succeeds, fail the test
      throw new Error("Expected withdraw to fail when providing wrong wallet");
    } catch (err: any) {
      // Check that it fails with WalletAccountMismatch error
      expect(err.toString()).to.include("WalletAccountMismatch");
    }
  });

  it("✅ PDA uniqueness: Different users can use same order_id without collision", async () => {
    const user1 = anchor.web3.Keypair.generate();
    const user2 = anchor.web3.Keypair.generate();
    const sameOrderId = "SHARED_ORDER_SOL";
    const depositAmount = new anchor.BN(0.1 * anchor.web3.LAMPORTS_PER_SOL);

    // Airdrop SOL to both users
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user1.publicKey, 1e9)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, 1e9)
    );

    // Derive PDAs - should be DIFFERENT even with same order_id
    const [depositRecordPda1] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), user1.publicKey.toBuffer(), Buffer.from(sameOrderId)],
      program.programId
    );
    const [depositRecordPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), user2.publicKey.toBuffer(), Buffer.from(sameOrderId)],
      program.programId
    );

    // Verify PDAs are different
    expect(depositRecordPda1.toBase58()).to.not.eq(depositRecordPda2.toBase58());
    console.log("✅ PDAs are unique for different users with same order_id");

    // Both deposits should succeed
    await program.methods
      .deposit(sameOrderId, depositAmount)
      .accounts({
        depositor: user1.publicKey,
        vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda1,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    await program.methods
      .deposit(sameOrderId, depositAmount)
      .accounts({
        depositor: user2.publicKey,
        vaultPda,
        vaultState: vaultStatePda,
        depositRecord: depositRecordPda2,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    // Verify both records exist with correct data
    const record1 = await program.account.depositRecord.fetch(depositRecordPda1);
    const record2 = await program.account.depositRecord.fetch(depositRecordPda2);

    expect(record1.user.toBase58()).to.eq(user1.publicKey.toBase58());
    expect(record2.user.toBase58()).to.eq(user2.publicKey.toBase58());
    expect(record1.orderId).to.eq(sameOrderId);
    expect(record2.orderId).to.eq(sameOrderId);

    console.log("✅ Both deposits succeeded with unique PDAs despite same order_id");
  });

  it("🚫 PDA collision attack prevented: User cannot create deposit for another user's PDA", async () => {
    const attacker = anchor.web3.Keypair.generate();
    const victim = anchor.web3.Keypair.generate();
    const orderId = "ATTACK_ORDER_SOL";
    const depositAmount = new anchor.BN(0.05 * anchor.web3.LAMPORTS_PER_SOL);

    // Airdrop SOL to attacker
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(attacker.publicKey, 1e9)
    );

    // Derive victim's PDA (using victim's key)
    const [victimDepositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("deposit_record"), victim.publicKey.toBuffer(), Buffer.from(orderId)],
      program.programId
    );

    try {
      // Attacker tries to deposit but uses victim's PDA
      // This should fail because the PDA seeds won't match the signer (attacker)
      await program.methods
        .deposit(orderId, depositAmount)
        .accounts({
          depositor: attacker.publicKey,  // Attacker is the signer
          vaultPda,
          vaultState: vaultStatePda,
          depositRecord: victimDepositRecordPda,  // But trying to use victim's PDA
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();

      expect.fail("Expected attack to fail due to PDA seed mismatch");
    } catch (err: any) {
      const msg = err.toString();
      console.log("Attack blocked:", msg);
      // Should fail with ConstraintSeeds error
      expect(msg).to.match(/(ConstraintSeeds|seeds|Invalid)/i);
      console.log("✅ PDA collision attack prevented - seeds validation works correctly");
    }
  });
});
