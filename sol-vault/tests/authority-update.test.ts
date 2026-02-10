import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getTestEnvironment,
  getVaultStatePda,
  getVaultPda,
  ensureVaultInitialized,
  getEventsFromTransaction,
} from "./helpers/utils";

describe("🎉 SOL Vault Program - Authority Update", () => {
  const { provider, program, authority } = getTestEnvironment();

  let vaultStatePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let newAuthority: anchor.web3.Keypair;
  let unauthorizedUser: anchor.web3.Keypair;

  before(async () => {
    // Derive PDAs
    [vaultStatePda] = getVaultStatePda(program.programId);
    [vaultPda] = getVaultPda(program.programId);

    // Initialize vault if not already initialized
    await ensureVaultInitialized(program, vaultStatePda, authority.publicKey);

    // Create new authority keypair
    newAuthority = anchor.web3.Keypair.generate();

    // Create unauthorized user keypair
    unauthorizedUser = anchor.web3.Keypair.generate();

    // Airdrop SOL to new authority for transaction fees
    const signature = await provider.connection.requestAirdrop(
      newAuthority.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Airdrop SOL to unauthorized user for transaction fees
    const signature2 = await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature2);

    console.log("✅ Setup complete");
  });

  after(async () => {
    // Ensure authority is restored to original after all tests
    try {
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      if (vaultState.authority.toString() !== authority.publicKey.toString()) {
        await program.methods
          .updateAuthority(authority.publicKey)
          .accounts({
            vaultState: vaultStatePda,
            authority: newAuthority.publicKey,
          })
          .signers([newAuthority])
          .rpc();
        console.log("✅ Authority restored to original in cleanup");
      }
    } catch (err) {
      console.log("⚠️ Could not restore authority in cleanup:", err.message);
    }
  });

  it("✅ Can successfully transfer authority to new admin", async () => {
    // Get current authority before transfer
    const vaultStateBefore = await program.account.vaultState.fetch(
      vaultStatePda
    );
    const previousAuthority = vaultStateBefore.authority;

    // Transfer authority
    const tx = await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify authority was updated
    const vaultStateAfter = await program.account.vaultState.fetch(
      vaultStatePda
    );
    expect(vaultStateAfter.authority.toString()).to.equal(
      newAuthority.publicKey.toString()
    );
    expect(vaultStateAfter.authority.toString()).to.not.equal(
      previousAuthority.toString()
    );

    console.log("✅ Authority successfully transferred");

    // ALWAYS restore authority, even if test fails
    await program.methods
      .updateAuthority(authority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();
  });

  it("✅ Emits AuthorityUpdatedEvent with correct data", async () => {
    // Ensure we start from the original authority state
    const currentVaultState = await program.account.vaultState.fetch(
      vaultStatePda
    );
    
    // Transfer to new authority and capture event
    const tx = await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    try {
      // Get transaction details to parse events
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      const events = getEventsFromTransaction(program, txDetails);
      
      // Find AuthorityUpdatedEvent (Anchor converts to camelCase)
      const authorityEvent = events.find(
        (e) => e.name === "authorityUpdatedEvent"
      );

      expect(authorityEvent).to.exist;
      expect(authorityEvent.data.vaultState.toString()).to.equal(
        vaultStatePda.toString()
      );
      expect(authorityEvent.data.previousAuthority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(authorityEvent.data.newAuthority.toString()).to.equal(
        newAuthority.publicKey.toString()
      );
      // Timestamp might be a BN object, convert to number
      const timestamp = typeof authorityEvent.data.timestamp === 'number' 
        ? authorityEvent.data.timestamp 
        : authorityEvent.data.timestamp.toNumber();
      expect(timestamp).to.be.a("number");
      expect(timestamp).to.be.greaterThan(0);

      console.log("✅ AuthorityUpdatedEvent emitted correctly");
    } finally {
      // ALWAYS restore authority, even if assertions fail
      await program.methods
        .updateAuthority(authority.publicKey)
        .accounts({
          vaultState: vaultStatePda,
          authority: newAuthority.publicKey,
        })
        .signers([newAuthority])
        .rpc();
    }
  });

  it("❌ Rejects authority transfer from unauthorized user", async () => {
    try {
      await program.methods
        .updateAuthority(unauthorizedUser.publicKey)
        .accounts({
          vaultState: vaultStatePda,
          authority: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();

      // Should not reach here
      expect.fail("Should have thrown an error for unauthorized access");
    } catch (err) {
      // Anchor error for has_one constraint violation
      expect(err.toString()).to.include("ConstraintHasOne");
      console.log("✅ Unauthorized transfer correctly rejected");
    }
  });

  it("❌ Rejects transfer to default public key", async () => {
    try {
      await program.methods
        .updateAuthority(anchor.web3.PublicKey.default)
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      // Should not reach here
      expect.fail("Should have thrown an error for default pubkey");
    } catch (err) {
      expect(err.toString()).to.include("InvalidNewAuthority");
      console.log("✅ Default pubkey correctly rejected");
    }
  });

  it("❌ Rejects transfer to vault PDA", async () => {
    try {
      await program.methods
        .updateAuthority(vaultPda)
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      // Should not reach here
      expect.fail("Should have thrown an error for vault PDA");
    } catch (err) {
      expect(err.toString()).to.include("AuthorityCannotBeVaultAccount");
      console.log("✅ Vault PDA correctly rejected");
    }
  });

  it("❌ Rejects transfer to vault state PDA", async () => {
    try {
      await program.methods
        .updateAuthority(vaultStatePda)
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
        })
        .rpc();

      // Should not reach here
      expect.fail("Should have thrown an error for vault state PDA");
    } catch (err) {
      expect(err.toString()).to.include("AuthorityCannotBeVaultAccount");
      console.log("✅ Vault state PDA correctly rejected");
    }
  });

  it("✅ Previous authority cannot perform admin actions after transfer", async () => {
    // Transfer authority to new authority
    await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    try {
      // Try to set withdrawal account with old authority (should fail)
      const testWallet = anchor.web3.Keypair.generate();
      await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: authority.publicKey,
          newWallet: testWallet.publicKey,
        })
        .rpc();

      // Should not reach here
      expect.fail(
        "Old authority should not be able to perform admin actions"
      );
    } catch (err) {
      // Anchor error for has_one constraint violation
      expect(err.toString()).to.include("ConstraintHasOne");
      console.log("✅ Previous authority correctly denied admin access");
    } finally {
      // ALWAYS transfer authority back to original for cleanup
      await program.methods
        .updateAuthority(authority.publicKey)
        .accounts({
          vaultState: vaultStatePda,
          authority: newAuthority.publicKey,
        })
        .signers([newAuthority])
        .rpc();
    }
  });

  it("✅ New authority can perform admin actions after transfer", async () => {
    // Transfer authority to new authority
    await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    try {
      // New authority should be able to set withdrawal account
      const testWallet = anchor.web3.Keypair.generate();
      const tx = await program.methods
        .setWithdrawalAccount()
        .accounts({
          vaultState: vaultStatePda,
          authority: newAuthority.publicKey,
          newWallet: testWallet.publicKey,
        })
        .signers([newAuthority])
        .rpc();

      await provider.connection.confirmTransaction(tx, "confirmed");

      // Verify withdrawal wallet was updated
      const vaultState = await program.account.vaultState.fetch(vaultStatePda);
      expect(vaultState.walletAccount.toString()).to.equal(
        testWallet.publicKey.toString()
      );

      console.log("✅ New authority can perform admin actions");
    } finally {
      // ALWAYS transfer authority back to original for cleanup
      await program.methods
        .updateAuthority(authority.publicKey)
        .accounts({
          vaultState: vaultStatePda,
          authority: newAuthority.publicKey,
        })
        .signers([newAuthority])
        .rpc();
    }
  });
});
