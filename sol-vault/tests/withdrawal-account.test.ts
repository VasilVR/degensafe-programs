import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  getTestEnvironment,
  getVaultStatePda,
  ensureVaultInitialized,
} from "./helpers/utils";

describe("🎉 SOL Vault Program - Withdrawal Account", () => {
  const { provider, program, authority } = getTestEnvironment();

  let vaultStatePda: anchor.web3.PublicKey;
  let withdrawalWallet: anchor.web3.Keypair;

  before(async () => {
    // Derive PDAs
    [vaultStatePda] = getVaultStatePda(program.programId);

    // Initialize vault if not already initialized
    await ensureVaultInitialized(program, vaultStatePda, authority.publicKey);

    withdrawalWallet = anchor.web3.Keypair.generate();

    // Airdrop SOL to withdrawal wallet
    const signature = await provider.connection.requestAirdrop(
      withdrawalWallet.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    console.log("✅ Setup complete");
  });

  it("✅ Can set withdrawal account", async () => {
    const tx = await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority.publicKey,
        newWallet: withdrawalWallet.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");

    // Verify withdrawal wallet was set
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.walletAccount.toString()).to.equal(
      withdrawalWallet.publicKey.toString()
    );
    console.log("✅ Withdrawal account set successfully");
  });
});
