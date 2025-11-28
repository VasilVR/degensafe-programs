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
import bs58 from 'bs58';
import { IDL as idl } from './idl.js';

const PROGRAM_ID = new PublicKey("GYMDMX2rWcbuAQyRDBPKxnGuSe1RMrHir14CwBRdJjAP");

// 🟢 1. Setup connection
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// 🟢 2. Load keypair
const user = Keypair.fromSecretKey(
      bs58.decode('3E4XKUn8d...UnXEnJJ46MRJ')
);

// 🟢 3. Build program
const program = new Program(idl, { connection });

// 🟢 4. Derive PDA
const [vaultState] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_state")],
  PROGRAM_ID
);

// 🟢 5. Airdrop for local testing
await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
await new Promise((r) => setTimeout(r, 2000));

// 🟢 6. Build initialize instruction
const initIx = await program.methods
  .initialize()
  .accounts({
    vaultState,
    authority: user.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

// 🟢 7. Send transaction
const tx = new Transaction().add(initIx);
const txSig = await sendAndConfirmTransaction(connection, tx, [user]);
console.log("✅ Initialize tx:", txSig);

// 🟢 8. Fetch vault state
const vault = await program.account.vaultState.fetch(vaultState);
console.log("🏦 Vault:", vault);
