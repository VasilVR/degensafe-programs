import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccount,
    createMint,
    getAssociatedTokenAddressSync,
    mintTo,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { LcVaultProgram } from "../target/types/lc_vault_program";

describe("🧩 lc_vault_program end-to-end", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LcVaultProgram as Program<LcVaultProgram>;

  const authority = provider.wallet;
  let mint: anchor.web3.PublicKey;
  let vaultState: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let vaultBump: number;

  before(async () => {
    // Create token mint
    mint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6 // decimals
    );

    // Derive PDA for vault_state
    [vaultState, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state"), mint.toBuffer()],
      program.programId
    );

    vaultTokenAccount = getAssociatedTokenAddressSync(mint, vaultState, true);
  });

  it("✅ Initializes the vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        vaultState,
        vaultTokenAccount,
        authority: authority.publicKey,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.authority.toBase58()).to.eq(authority.publicKey.toBase58());
    console.log("✅ Vault initialized:", state);
  });

  it("✅ Creates wallet ATA only if missing", async () => {
    const user = anchor.web3.Keypair.generate();
    const expectedAta = getAssociatedTokenAddressSync(mint, user.publicKey);

    // Confirm ATA doesn’t exist
    let ataInfo = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfo).to.be.null;
    console.log("ℹ️ ATA not found, will be created...");

    await program.methods
      .createWalletAtaIfNeeded(user.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: user.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    ataInfo = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfo).to.not.be.null;
    console.log("✅ ATA created:", expectedAta.toBase58());

    // Call again — should detect existing ATA
    await program.methods
      .createWalletAtaIfNeeded(user.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: user.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("♻️ Called again, ATA already existed (no recreate).");
  });

  it("✅ Sets withdrawal wallet and automatically creates ATA", async () => {
    const newWallet = anchor.web3.Keypair.generate();
    const expectedAta = getAssociatedTokenAddressSync(mint, newWallet.publicKey);

    const ataInfoBefore = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfoBefore).to.be.null;

    await program.methods
      .setWithdrawalAccount(newWallet.publicKey)
      .accounts({
        vaultState,
        authority: authority.publicKey,
        newWallet: newWallet.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const ataInfoAfter = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfoAfter).to.not.be.null;
    console.log("✅ ATA auto-created for new wallet:", expectedAta.toBase58());
  });

  it("🚫 Fails withdrawal if withdrawal wallet has no ATA", async () => {
    const noAtaWallet = anchor.web3.Keypair.generate();

    const destAta = getAssociatedTokenAddressSync(mint, noAtaWallet.publicKey);
    const ataInfo = await provider.connection.getAccountInfo(destAta);
    expect(ataInfo).to.be.null;
    console.log("ℹ️ No ATA exists for withdrawal wallet.");

    try {
      await program.methods
        .withdraw()
        .accounts({
          vaultState,
          vaultTokenAccount,
          destinationTokenAccount: destAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("🚨 Should have failed, no ATA exists");
    } catch (err) {
      expect(err.toString()).to.match(/(InvalidAccountData|AccountNotInitialized|AnchorError)/);
console.log("✅ Correctly failed when no ATA exists:", err.toString());
    }
  });

  it("✅ Checks vault balance and details", async () => {
    await program.methods
      .check()
      .accounts({
        vaultState,
        vaultTokenAccount,
      })
      .rpc();
    console.log("✅ Vault check ran successfully.");
  });

 it("✅ Deposits tokens into vault and checks record", async () => {
  const user = anchor.web3.Keypair.generate();

  // Airdrop SOL to user
  const sig = await provider.connection.requestAirdrop(
    user.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig);

  // 🪙 Create user's ATA
  const userTokenAccount = await createAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mint,
    user.publicKey
  );

  // 🪙 Mint tokens to user
  await mintTo(
    provider.connection,
    authority.payer,
    mint,
    userTokenAccount,
    authority.publicKey,
    100_000_000 // 100 tokens
  );

  const orderId = "ORDER123";

  // 🧩 Derive PDAs
  const [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), mint.toBuffer()],
    program.programId
  );
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    mint,
    vaultStatePda,
    true // allow PDA authority
  );
  const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_record"), mint.toBuffer(), Buffer.from(orderId)],
    program.programId
  );

  // ✅ Make sure vault is initialized first
  await program.methods
    .initialize()
    .accounts({
      vaultState: vaultStatePda,
      vaultTokenAccount,
      authority: authority.publicKey,
      tokenMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  // ✅ Perform deposit
  await program.methods
    .deposit(orderId, new anchor.BN(10_000_000)) // deposit 10 tokens
    .accounts({
      user: user.publicKey,
      userTokenAccount,
      vaultState: vaultStatePda,
      vaultTokenAccount,
      depositRecord: depositRecordPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();

  // 🧾 Verify record
  const record = await program.account.depositRecord.fetch(depositRecordPda);
  expect(record.amount.toNumber()).to.eq(10_000_000);
  expect(record.user.toBase58()).to.eq(user.publicKey.toBase58());
  console.log("✅ Deposit recorded successfully:", record);

  // 🧮 Verify vault token balance on-chain
  const vaultTokenInfo = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
  console.log("🏦 Vault token balance:", vaultTokenInfo.value.uiAmount);
});


});
