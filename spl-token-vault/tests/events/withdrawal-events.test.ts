import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  initializeTestEnvironment,
  createTestTokenMint,
  deriveVaultStatePda,
  getVaultTokenAccount,
} from "../helpers/setup-utils";
import { getEventsFromTransaction } from "../helpers/utils";

describe("🎉 SPL Token Vault Program - Withdrawal Events", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let withdrawalWallet: anchor.web3.Keypair;

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

    withdrawalWallet = anchor.web3.Keypair.generate();

    console.log("✅ Setup complete");
  });

  it("✅ WithdrawalWalletUpdatedEvent emitted when setting withdrawal wallet", async () => {
    // Airdrop SOL to withdrawal wallet for rent
    const signature = await provider.connection.requestAirdrop(
      withdrawalWallet.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(signature);

    // Get ATA for withdrawal wallet
    const withdrawalWalletAta = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: withdrawalWallet.publicKey,
    });

    const tx = await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        newWallet: withdrawalWallet.publicKey,
        associatedToken: withdrawalWalletAta,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "withdrawalWalletUpdatedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(vaultStatePda.toString());
    expect(event.data.newWallet.toString()).to.equal(
      withdrawalWallet.publicKey.toString(),
    );
    console.log("✅ WithdrawalWalletUpdatedEvent emitted with correct data");
  });

  it("✅ WithdrawEvent emitted when withdrawing tokens", async () => {
    // First, deposit some tokens into the vault
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tokenMint,
      authority.publicKey,
    );

    await mintTo(
      provider.connection,
      authority.payer,
      tokenMint,
      userTokenAccountInfo.address,
      authority.payer,
      1_000_000_000, // 1000 tokens
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
      program.programId,
    );

    // Deposit tokens
    await program.methods
      .deposit(orderId, depositAmount)
      .accounts({
        user: authority.publicKey,
        userTokenAccount: userTokenAccountInfo.address,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        depositRecord: depositRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Now perform the withdrawal
    const withdrawalWalletAta = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: withdrawalWallet.publicKey,
    });

    const tx = await program.methods
      .withdraw()
      .accounts({
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccount,
        destinationTokenAccount: withdrawalWalletAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "withdrawEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(vaultStatePda.toString());
    expect(event.data.tokenMint.toString()).to.equal(tokenMint.toString());
    console.log("✅ WithdrawEvent emitted with correct data");
  });

  it("✅ AuthorityUpdatedEvent emitted when updating authority", async () => {
    const newAuthority = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "authorityUpdatedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(vaultStatePda.toString());
    expect(event.data.newAuthority.toString()).to.equal(
      newAuthority.publicKey.toString(),
    );
    console.log("✅ AuthorityUpdatedEvent emitted with correct data");

    // Note: Vault is now owned by newAuthority, so we can't run further tests
    // that require authority signature without updating our test setup
  });
});
