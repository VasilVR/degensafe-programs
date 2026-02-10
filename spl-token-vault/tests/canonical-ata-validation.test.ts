import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAccount,
} from "@solana/spl-token";

describe("SPL Token Vault - Strict Canonical ATA Validation", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.SplTokenVaultProgram as Program;
  const wallet = provider.wallet as anchor.Wallet;

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    // Create a test token mint
    const mintKeypair = anchor.web3.Keypair.generate();
    tokenMint = mintKeypair.publicKey;

    const createMintIx = anchor.web3.SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: tokenMint,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    });

    const initMintIx = createInitializeMintInstruction(
      tokenMint,
      0, // decimals
      wallet.publicKey, // mint authority
      null, // freeze authority
      TOKEN_PROGRAM_ID
    );

    // Derive vault PDA
    [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state"), tokenMint.toBuffer()],
      program.programId
    );

    vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultStatePda,
      true
    );

    // Initialize vault if needed
    try {
      await program.account.vaultState.fetch(vaultStatePda);
    } catch (err) {
      const tx = new anchor.web3.Transaction();
      tx.add(createMintIx, initMintIx);
      await provider.sendAndConfirm(tx, [mintKeypair]);

      await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          authority: wallet.publicKey,
          tokenMint: tokenMint,
        })
        .rpc();
    }
  });

  it("✅ Successfully sets withdrawal wallet with canonical ATA", async () => {
    const validWallet = anchor.web3.Keypair.generate().publicKey;
    
    // Get the canonical ATA address
    const canonicalAta = getAssociatedTokenAddressSync(
      tokenMint,
      validWallet,
      false // allowOwnerOffCurve = false (standard)
    );

    // This should succeed
    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        newWallet: validWallet,
        associatedToken: canonicalAta,
        tokenMint: tokenMint,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toBase58()).to.eq(validWallet.toBase58());
    console.log("✅ Successfully set withdrawal wallet with canonical ATA");
  });

  it("🚫 Fails to set withdrawal wallet with non-canonical ATA (wrong address)", async () => {
    const validWallet = anchor.web3.Keypair.generate().publicKey;
    
    // Get the canonical ATA address
    const canonicalAta = getAssociatedTokenAddressSync(
      tokenMint,
      validWallet,
      false
    );
    
    // Use a DIFFERENT address instead of canonical ATA
    const nonCanonicalAddress = anchor.web3.Keypair.generate().publicKey;
    
    // Verify they're different
    expect(canonicalAta.toBase58()).to.not.equal(nonCanonicalAddress.toBase58());

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: validWallet,
          associatedToken: nonCanonicalAddress, // Non-canonical address!
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for non-canonical ATA");
    } catch (err: any) {
      // Should fail with InvalidWithdrawalWallet error
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
      console.log("✅ Correctly rejected non-canonical ATA address");
    }
  });

  it("🚫 Fails to set withdrawal wallet with non-canonical token account", async () => {
    const validWallet = anchor.web3.Keypair.generate();
    
    // Get the canonical ATA address
    const canonicalAta = getAssociatedTokenAddressSync(
      tokenMint,
      validWallet.publicKey,
      false
    );
    
    // Create a NON-ATA token account for the same wallet
    // This is a valid token account but NOT the canonical ATA
    const nonCanonicalTokenAccountKeypair = anchor.web3.Keypair.generate();
    const nonCanonicalTokenAccount = await createAccount(
      provider.connection,
      wallet.payer,
      tokenMint,
      validWallet.publicKey,
      nonCanonicalTokenAccountKeypair, // force a non-ATA address
      undefined,
      TOKEN_PROGRAM_ID
    );
    
    // Verify they're different addresses
    expect(canonicalAta.toBase58()).to.not.equal(nonCanonicalTokenAccount.toBase58());

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: validWallet.publicKey,
          associatedToken: nonCanonicalTokenAccount, // Valid token account but NOT canonical ATA!
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for non-canonical token account");
    } catch (err: any) {
      // Should fail with InvalidWithdrawalWallet error due to address mismatch
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
      console.log("✅ Correctly rejected non-canonical token account");
    }
  });

  it("✅ Allows update to a different canonical ATA", async () => {
    const anotherValidWallet = anchor.web3.Keypair.generate().publicKey;
    
    // Get the canonical ATA address
    const canonicalAta = getAssociatedTokenAddressSync(
      tokenMint,
      anotherValidWallet,
      false
    );

    // This should succeed - updating to a different wallet's canonical ATA
    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        newWallet: anotherValidWallet,
        associatedToken: canonicalAta,
        tokenMint: tokenMint,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toBase58()).to.eq(anotherValidWallet.toBase58());
    console.log("✅ Successfully updated to another wallet's canonical ATA");
  });
});
