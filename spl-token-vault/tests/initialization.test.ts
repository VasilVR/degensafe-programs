import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  initializeTestEnvironment,
  createTestTokenMint,
  deriveVaultStatePda,
  getVaultTokenAccount,
} from "./helpers/setup-utils";

describe("🎉 SPL Token Vault Program - Initialization", () => {
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

  it("✅ Initializes the vault successfully", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        tokenMint: tokenMint,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify vault state
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.authority.toString()).to.equal(
      authority.publicKey.toString()
    );
    expect(vaultState.tokenMint.toString()).to.equal(tokenMint.toString());

    console.log("✅ Vault initialized successfully");
  });

  it("✅ Vault token account is created correctly", async () => {
    vaultTokenAccount = await getVaultTokenAccount(tokenMint, vaultStatePda);

    const accountInfo = await provider.connection.getAccountInfo(
      vaultTokenAccount
    );
    expect(accountInfo).to.not.be.null;

    console.log("✅ Vault token account exists:", vaultTokenAccount.toString());
  });
});
