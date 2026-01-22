import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { 
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("spl_token_vault_program - Enhanced Withdrawal Wallet Validation", () => {
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

  it("Fails to set withdrawal wallet to default public key", async () => {
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      anchor.web3.PublicKey.default,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: anchor.web3.PublicKey.default,
          associatedToken: associatedToken,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for default public key");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Fails to set withdrawal wallet to program ID", async () => {
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      program.programId,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: program.programId,
          associatedToken: associatedToken,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for program ID");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Fails to set withdrawal wallet to system program", async () => {
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      anchor.web3.SystemProgram.programId,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: anchor.web3.SystemProgram.programId,
          associatedToken: associatedToken,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for system program");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Fails to set withdrawal wallet to vault state PDA", async () => {
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      vaultStatePda,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: vaultStatePda,
          associatedToken: associatedToken,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for vault state PDA");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Fails to set withdrawal wallet to token mint", async () => {
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      tokenMint,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: tokenMint,
          associatedToken: associatedToken,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for token mint");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Fails to set withdrawal wallet to vault token account", async () => {
    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: vaultTokenAccount,
          associatedToken: vaultTokenAccount,
          tokenMint: tokenMint,
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for vault token account");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidWithdrawalWallet");
    }
  });

  it("Successfully sets withdrawal wallet to valid address", async () => {
    const validWallet = anchor.web3.Keypair.generate().publicKey;
    const associatedToken = getAssociatedTokenAddressSync(
      tokenMint,
      validWallet,
      true
    );

    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: wallet.publicKey,
        newWallet: validWallet,
        associatedToken: associatedToken,
        tokenMint: tokenMint,
      })
      .rpc();

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toBase58()).to.eq(validWallet.toBase58());
  });

  it("Withdraw validates wallet_account security checks", async () => {
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    
    // The wallet should be valid from the previous test
    expect(vaultState.walletAccount).to.not.deep.equal(anchor.web3.PublicKey.default);
    expect(vaultState.walletAccount).to.not.deep.equal(program.programId);
    expect(vaultState.walletAccount).to.not.deep.equal(anchor.web3.SystemProgram.programId);
    expect(vaultState.walletAccount).to.not.deep.equal(vaultStatePda);
    expect(vaultState.walletAccount).to.not.deep.equal(tokenMint);
    expect(vaultState.walletAccount).to.not.deep.equal(vaultTokenAccount);
  });

  it("Fails to set withdrawal wallet with mismatched token mint", async () => {
    // Create a different token mint
    const wrongMintKeypair = anchor.web3.Keypair.generate();
    const wrongTokenMint = wrongMintKeypair.publicKey;

    const createMintIx = anchor.web3.SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: wrongTokenMint,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    });

    const initMintIx = createInitializeMintInstruction(
      wrongTokenMint,
      0, // decimals
      wallet.publicKey, // mint authority
      null, // freeze authority
      TOKEN_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction();
    tx.add(createMintIx, initMintIx);
    await provider.sendAndConfirm(tx, [wrongMintKeypair]);

    // Try to set withdrawal account using the wrong token mint
    const validWallet = anchor.web3.Keypair.generate().publicKey;
    const associatedToken = getAssociatedTokenAddressSync(
      wrongTokenMint, // Using wrong mint
      validWallet,
      true
    );

    try {
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: wallet.publicKey,
          newWallet: validWallet,
          associatedToken: associatedToken,
          tokenMint: wrongTokenMint, // Wrong mint!
        })
        .rpc();

      throw new Error("Expected setWithdrawalAccount to fail for mismatched token mint");
    } catch (err: any) {
      // has_one constraint throws ConstraintHasOne error when token_mint doesn't match
      expect(err.toString()).to.match(/ConstraintHasOne|has_one/i);
    }
  });
});
