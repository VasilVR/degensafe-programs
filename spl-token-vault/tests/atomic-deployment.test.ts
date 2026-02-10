import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { createMint, getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("🔒 SPL Token Vault Program - Atomic Deployment Security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SplTokenVaultProgram;
  const authority = provider.wallet as anchor.Wallet;

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    // Create a test token mint
    tokenMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );

    // Derive vault state PDA
    [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state"), tokenMint.toBuffer()],
      program.programId
    );

    // Derive vault token account
    vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultStatePda,
      true
    );

    console.log("✅ Setup complete for atomic deployment tests");
    console.log(`   Token Mint: ${tokenMint.toString()}`);
  });

  it("✅ Vault initialization is protected by 'init' constraint", async () => {
    let isInitialized = false;
    let existingAuthority: anchor.web3.PublicKey | null = null;

    // Check if vault is already initialized
    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      isInitialized = true;
      existingAuthority = vaultState.authority;
      console.log("Vault already initialized");
    } catch (err) {
      console.log("Vault not initialized, initializing now...");
    }

    if (!isInitialized) {
      // Initialize vault
      const tx = await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          authority: authority.publicKey,
          tokenMint: tokenMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify initialization
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      expect(vaultState.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(vaultState.tokenMint.toString()).to.equal(tokenMint.toString());
      existingAuthority = vaultState.authority;
      console.log("✅ Vault initialized successfully");
    }

    // CRITICAL TEST: Attempt to reinitialize should fail
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          authority: authority.publicKey,
          tokenMint: tokenMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      expect.fail(
        "Reinitialization should have failed but succeeded - SECURITY ISSUE!"
      );
    } catch (error: any) {
      const errorMsg = error.toString();
      expect(
        errorMsg.includes("already in use") ||
          errorMsg.includes("custom program error")
      ).to.be.true;
      console.log("✅ Reinitialization correctly prevented");
    }

    // Verify the authority hasn't changed
    const finalVaultState = await program.account.vaultState.fetch(
      vaultStatePda
    );
    expect(finalVaultState.authority.toString()).to.equal(
      existingAuthority!.toString()
    );
    console.log("✅ Authority remains unchanged - no unauthorized takeover");
  });

  it("✅ Idempotent deployment script behavior", async () => {
    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);

      // Vault exists - verify state is consistent
      expect(vaultState.authority).to.not.equal(anchor.web3.PublicKey.default);
      expect(vaultState.tokenMint.toString()).to.equal(tokenMint.toString());
      console.log(
        "✅ Vault state is consistent, can be queried multiple times safely"
      );
    } catch (err) {
      expect.fail("Vault should exist at this point");
    }
  });

  it("✅ Verify deployment script would detect existing initialization", async () => {
    let alreadyInitialized = false;

    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      alreadyInitialized = true;
      console.log(
        "✅ Deployment script would correctly detect existing vault"
      );
      console.log(`   Current authority: ${vaultState.authority.toString()}`);
      console.log(`   Token mint: ${vaultState.tokenMint.toString()}`);
    } catch (error) {
      console.log("Vault not initialized - would proceed with initialization");
    }

    expect(alreadyInitialized).to.be.true;
  });
});
