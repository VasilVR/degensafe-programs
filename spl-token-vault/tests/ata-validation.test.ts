import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  createMint,
  getAssociatedTokenAddressSync,
  createAccount,
} from "@solana/spl-token";
import {
  initializeTestEnvironment,
  createTestTokenMint,
} from "./helpers/setup-utils";

describe("🔒 SPL Token Vault Program - ATA Validation", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;

  before(async () => {
    // Create token mint
    tokenMint = await createTestTokenMint(provider, authority);
    console.log("✅ Test setup complete");
  });

  it("✅ Creates new ATA when it doesn't exist", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );

    // Verify ATA doesn't exist yet
    let accountInfo = await provider.connection.getAccountInfo(testWalletAta);
    expect(accountInfo).to.be.null;

    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify ATA now exists
    accountInfo = await provider.connection.getAccountInfo(testWalletAta);
    expect(accountInfo).to.not.be.null;

    console.log("✅ ATA created successfully");
  });

  it("✅ Validates existing ATA successfully", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );

    // First create the ATA
    const createTx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(createTx, "confirmed");

    // Call again to validate existing ATA
    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify ATA exists and is valid
    const accountInfo = await provider.connection.getAccountInfo(testWalletAta);
    expect(accountInfo).to.not.be.null;

    // Verify it's rent exempt
    const rent = await provider.connection.getMinimumBalanceForRentExemption(
      accountInfo.data.length
    );
    expect(accountInfo.lamports).to.be.at.least(rent);

    console.log("✅ Existing ATA validated successfully");
  });

  it("✅ Verifies ATA data length is correct", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );

    // Create the ATA
    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify the ATA has correct data length (165 bytes for SPL token account)
    const accountInfo = await provider.connection.getAccountInfo(testWalletAta);
    expect(accountInfo).to.not.be.null;
    expect(accountInfo.data.length).to.equal(165);

    console.log("✅ ATA data length verified (165 bytes)");
  });

  it("✅ Verifies ATA is rent-exempt", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );

    // Create the ATA
    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify rent exemption
    const accountInfo = await provider.connection.getAccountInfo(testWalletAta);
    expect(accountInfo).to.not.be.null;

    const minRent = await provider.connection.getMinimumBalanceForRentExemption(
      accountInfo.data.length
    );
    const isRentExempt = accountInfo.lamports >= minRent;
    expect(isRentExempt).to.be.true;

    console.log("✅ ATA is rent-exempt");
  });

  it("✅ Verifies ATA has correct mint and owner", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );

    // Create the ATA
    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify the token account has correct mint and owner
    const tokenAccount = await getAccount(
      provider.connection,
      testWalletAta,
      "confirmed"
    );

    expect(tokenAccount.mint.toString()).to.equal(tokenMint.toString());
    expect(tokenAccount.owner.toString()).to.equal(
      testWallet.publicKey.toString()
    );

    console.log("✅ ATA has correct mint and owner");
  });

  it("🚫 Fails with wrong mint for existing ATA", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    
    // Create a different token mint
    const wrongMint = await createTestTokenMint(provider, authority);
    
    // Create ATA for the first mint
    const correctAta = getAssociatedTokenAddressSync(
      tokenMint,
      testWallet.publicKey
    );
    
    const createTx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: correctAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(createTx, "confirmed");

    // Try to validate with wrong mint - should fail
    try {
      await program.methods
        .createWalletAtaIfNeeded(testWallet.publicKey)
        .accounts({
          payer: authority.publicKey,
          wallet: testWallet.publicKey,
          associatedToken: correctAta, // This is for tokenMint, not wrongMint
          tokenMint: wrongMint, // Wrong mint
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      expect.fail("Should have failed with mint mismatch");
    } catch (err) {
      expect(err.toString()).to.match(/MintMismatch|AnchorError/);
      console.log("✅ Correctly failed with mint mismatch");
    }
  });

  it("🚫 Fails with non-token-program account", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    
    // Use a system account instead of a token account
    const fakeAta = anchor.web3.Keypair.generate().publicKey;
    
    // Airdrop to create a system account
    const airdropSig = await provider.connection.requestAirdrop(
      fakeAta,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    try {
      await program.methods
        .createWalletAtaIfNeeded(testWallet.publicKey)
        .accounts({
          payer: authority.publicKey,
          wallet: testWallet.publicKey,
          associatedToken: fakeAta, // System account, not a token account
          tokenMint: tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      expect.fail("Should have failed with corrupted token account");
    } catch (err) {
      // Check for the custom error message or anchor error
      const errStr = err.toString();
      const hasExpectedError = 
        errStr.includes("CorruptedTokenAccount") ||
        errStr.includes("corrupted or invalid") ||
        errStr.includes("AnchorError") ||
        errStr.includes("InvalidAccountData") ||
        errStr.includes("0x178f") || // Error code for CorruptedTokenAccount (last in enum)
        errStr
          .toLowerCase()
          .includes("an account required by the instruction is missing");
      expect(hasExpectedError, `Unexpected error: ${errStr}`).to.be.true;
      console.log("✅ Correctly failed with non-token-program account");
    }
  });
});
