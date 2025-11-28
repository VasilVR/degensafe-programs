import { Program } from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction
} from "@solana/web3.js";
import bs58 from "bs58";
import { IDL as idl } from './idl.js';

const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load authority wallet (same that initialized the vault)
const authority = Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...mKYnaLwUnXEnJJ46MRJ")
);

const program = new Program(idl, { connection });

async function main() {
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    PROGRAM_ID
  );

  // new wallet to set
  const newWallet = new PublicKey("DY1hBB1ZZNbtpqnx5hyJ8uWH9eFzCbz1Cnst6aZ9i1qa");

  console.log("Vault State PDA:", vaultState.toBase58());
  console.log("Setting new withdrawal wallet to:", newWallet.toBase58());

  const ix = await program.methods
    .setWithdrawalAccount(newWallet)
    .accounts({
      vaultState,
      authority: authority.publicKey,
    })
    .instruction();

  const tx = new Transaction().add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log("✅ Withdrawal account set successfully!");
  console.log("Signature:", sig);
}

main().catch((err) => console.error("❌ Error:", err));
