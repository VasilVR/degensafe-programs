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
} from "../helpers/setup-utils";
import { getEventsFromTransaction } from "../helpers/utils";

describe("🎉 SPL Token Vault Program - VaultInitializedEvent", () => {
  const { provider, program, authority } = initializeTestEnvironment();

  let tokenMint: anchor.web3.PublicKey;
  let vaultStatePda: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    // Create token mint
    tokenMint = await createTestTokenMint(provider, authority);

    // Derive vault state PDA
    [vaultStatePda] = deriveVaultStatePda(tokenMint, program.programId);

    console.log("✅ Setup complete");
  });

  it("✅ VaultInitializedEvent emitted on vault initialization", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    expect(txDetails).to.not.be.null;

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "vaultInitializedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.vaultState.toString()).to.equal(vaultStatePda.toString());
    expect(event.data.tokenMint.toString()).to.equal(tokenMint.toString());
    console.log("✅ VaultInitializedEvent emitted with correct data");

    // Get vault token account for later
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    const associatedTokenAddress = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: vaultStatePda,
    });
    vaultTokenAccount = associatedTokenAddress;
  });

  it("✅ AtaCreatedEvent emitted when creating ATA for wallet", async () => {
    // Create a new mint for this test
    const newMint = await createTestTokenMint(provider, authority);

    const testWallet = anchor.web3.Keypair.generate();
    const testWalletAta = await anchor.utils.token.associatedAddress({
      mint: newMint,
      owner: testWallet.publicKey,
    });

    const tx = await program.methods
      .createWalletAtaIfNeeded(testWallet.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: testWallet.publicKey,
        associatedToken: testWalletAta,
        tokenMint: newMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const events = getEventsFromTransaction(program, txDetails);
    const event = events.find((e) => e.name === "ataCreatedEvent");

    expect(event).to.not.be.undefined;
    expect(event.data.wallet.toString()).to.equal(
      testWallet.publicKey.toString()
    );
    expect(event.data.tokenMint.toString()).to.equal(newMint.toString());
    expect(event.data.ata.toString()).to.equal(testWalletAta.toString());
    console.log("✅ AtaCreatedEvent emitted with correct data");
  });
});
