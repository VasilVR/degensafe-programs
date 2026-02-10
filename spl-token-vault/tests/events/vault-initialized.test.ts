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

  // AtaCreatedEvent test removed
  // The createWalletAtaIfNeeded function and AtaCreatedEvent were removed per security audit.
  // ATA creation should be done client-side using @solana/spl-token createAssociatedTokenAccount().
});
