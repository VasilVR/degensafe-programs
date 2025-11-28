import { Program } from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import { IDL as idl } from "./idl.js";

const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, { connection });

const payer = Keypair.fromSecretKey(
  bs58.decode("3E4XK...naLwUnXEnJJ46MRJ")
);

async function main() {
  const orderId = "TEST_ORDER_002";
  const lamports = new BN(0.1 * LAMPORTS_PER_SOL);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_pda")],
    PROGRAM_ID
  );
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    PROGRAM_ID
  );
  const [depositRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_record"), Buffer.from(orderId)],
    PROGRAM_ID
  );

  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Vault State:", vaultState.toBase58());
  console.log("Deposit Record:", depositRecord.toBase58());

  const depositIx = await program.methods
    .deposit(orderId, lamports)
    .accounts({
      depositor: payer.publicKey,
      vaultPda,
      vaultState,
      depositRecord,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(depositIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

  console.log("✅ Deposit success, signature:", sig);

  try {
    const record = await program.account.depositRecord.fetch(depositRecord);
    console.log("Deposit record:", record);
  } catch (e) {
    console.warn("Could not fetch deposit record:", e.message);
  }
}

main().catch((err) => console.error("❌ Error:", err));
