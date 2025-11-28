
import { Program } from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { IDL as idl } from "./idl.js";

// --- constants ---
const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load vault authority (same keypair used to initialize the vault)
const authority = Keypair.fromSecretKey(
  bs58.decode("3E4XKUn8db...aLwUnXEnJJ46MRJ")
);

const program = new Program(idl, { connection });

async function main() {
  // Derive PDAs
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_pda")],
    PROGRAM_ID
  );

  // Wallet that will receive withdrawn SOL
  const walletAccount = new PublicKey("DY1hB...st6aZ9i1qa");

  console.log("Vault State PDA:", vaultState.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Withdrawing to:", walletAccount.toBase58());

  // Build withdraw instruction
  const ix = await program.methods
    .withdraw()
    .accounts({
      vaultState,
      vaultPda,
      walletAccount,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  // Create transaction
  const tx = new Transaction().add(ix);

  // Send transaction
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);

  console.log("✅ Withdrawal successful!");
  console.log("Transaction Signature:", sig);
}

main().catch((err) => console.error("❌ Error:", err));
