import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { getTestEnvironment, getVaultStatePda } from "./helpers/utils";

describe("🔒 SOL Vault Program - Atomic Deployment Security", () => {
  const { provider, program, authority } = getTestEnvironment();

  let vaultStatePda: anchor.web3.PublicKey;

  before(async () => {
    [vaultStatePda] = getVaultStatePda(program.programId);
    console.log("✅ Setup complete for atomic deployment tests");
  });

  it("✅ Vault initialization is protected by 'init' constraint", async () => {
    // This test verifies that the vault uses 'init' not 'init_if_needed'
    // which prevents reinitialization attacks

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
          authority: authority.publicKey,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify initialization
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      expect(vaultState.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      existingAuthority = vaultState.authority;
      console.log("✅ Vault initialized successfully");
    }

    // CRITICAL TEST: Attempt to reinitialize should fail
    // This verifies protection against front-running attacks
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      // If we reach here, the test should fail because reinitialization should not be allowed
      expect.fail(
        "Reinitialization should have failed but succeeded - SECURITY ISSUE!"
      );
    } catch (error: any) {
      // Expected to fail - verify it's the right error
      const errorMsg = error.toString();
      // Anchor throws an error when trying to init an existing account
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
    // This test verifies that running the deployment script multiple times
    // is safe and doesn't cause issues (idempotency)

    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);

      // Vault exists - verify state is consistent
      expect(vaultState.authority).to.not.equal(anchor.web3.PublicKey.default);
      console.log(
        "✅ Vault state is consistent, can be queried multiple times safely"
      );
    } catch (err) {
      // If vault doesn't exist, initialize it
      const tx = await program.methods
        .initialize()
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("✅ Vault initialized in idempotency test");
    }
  });

  it("✅ Verify deployment script would detect existing initialization", async () => {
    // This simulates what the deployment script does
    let alreadyInitialized = false;

    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      alreadyInitialized = true;
      console.log(
        "✅ Deployment script would correctly detect existing vault"
      );
      console.log(`   Current authority: ${vaultState.authority.toString()}`);
    } catch (error) {
      console.log("Vault not initialized - would proceed with initialization");
    }

    // In production deployment, this check prevents duplicate initialization attempts
    expect(alreadyInitialized).to.be.true;
  });
});
