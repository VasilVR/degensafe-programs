import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getTestEnvironment,
  getVaultStatePda,
} from "./helpers/utils";

describe("🎉 SOL Vault Program - Initialization", () => {
  const { provider, program, authority } = getTestEnvironment();

  let vaultStatePda: anchor.web3.PublicKey;

  before(async () => {
    // Derive PDAs
    [vaultStatePda] = getVaultStatePda(program.programId);

    console.log("✅ Setup complete");
  });

  it("✅ Can initialize vault", async () => {
    // Check if vault is already initialized (e.g., by another test file)
    try {
      const existingVault = await program.account.vaultState.fetch(
        vaultStatePda
      );
      // Vault already exists, verify it's properly set up
      expect(existingVault.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      console.log("Vault already initialized, skipping initialization");
    } catch (err) {
      // Vault doesn't exist, initialize it
      const tx = await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify vault state was created
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      expect(vaultState.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      console.log("✅ Vault initialized successfully");
    }
  });
});
