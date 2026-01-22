import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  initializeTestEnvironment,
  createTestTokenMint,
  deriveVaultStatePda,
  getVaultTokenAccount,
} from "./helpers/setup-utils";

describe("🎉 SPL Token Vault Program - Withdrawal Account", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

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

    console.log("✅ Setup complete");
  });

  it("✅ Sets withdrawal wallet successfully", async () => {
    const withdrawalWallet = anchor.web3.Keypair.generate();

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

    // Verify withdrawal wallet is set
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toString()).to.equal(
      withdrawalWallet.publicKey.toString(),
    );

    console.log("✅ Withdrawal wallet set successfully");
  });

  it("✅ Creates ATA for wallet if needed", async () => {
    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: testWallet.publicKey,
    });

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

  it("🚫 Fails withdrawal if withdrawal wallet has no ATA", async () => {
    const noAtaWallet = anchor.web3.Keypair.generate();
    const destAta = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: noAtaWallet.publicKey,
    });

    // Verify no ATA exists
    const ataInfo = await provider.connection.getAccountInfo(destAta);
    expect(ataInfo).to.be.null;

    try {
      await program.methods
        .withdraw()
        .accounts({
          vaultState: vaultStatePda,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: destAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed, no ATA exists");
    } catch (err) {
      expect(err.toString()).to.match(
        /(InvalidAccountData|AccountNotInitialized|AnchorError)/,
      );
      console.log("✅ Correctly failed when no ATA exists");
    }
  });

  it("✅ Updates authority successfully", async () => {
    const newAuthority = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify authority is updated
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.authority.toString()).to.equal(
      newAuthority.publicKey.toString(),
    );

    console.log("✅ Authority updated successfully");
  });
});
