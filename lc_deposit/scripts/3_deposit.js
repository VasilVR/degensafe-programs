import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
    createAssociatedTokenAccountInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import BN from 'bn.js';
import bs58 from "bs58";
import IDL from "./lcidl.js";

// 🟢 Setup
const PROGRAM_ID = new PublicKey(IDL.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

const authority = Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn8db...KYnaLwUnXEnJJ46MRJ"
  )
);

const TOKEN_MINT = new PublicKey("FSfi7yKWk9A9NViNmMx2qKxuvsVFiCb2DUgqqjGewc4f");

// 🟢 Anchor provider
const provider = new AnchorProvider(connection, { publicKey: authority.publicKey }, {});
const program = new Program(IDL, provider);

// 🧩 Derive PDAs
const [vaultState] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_state"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
);

console.log("PRORGAM ID", PROGRAM_ID?.toBase58(), "token mint", TOKEN_MINT.toBase58())
const vaultTokenAccount = getAssociatedTokenAddressSync(
  TOKEN_MINT,
  vaultState,
  true
);

const orderId = "TEST_ORDER_002";
const [depositRecord] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("deposit_record"),
    TOKEN_MINT.toBuffer(),
    Buffer.from(orderId),
  ],
  PROGRAM_ID
);

async function main() {
  console.log("Vault State PDA:", vaultState.toBase58());
  console.log("Vault Token ATA:", vaultTokenAccount.toBase58());
  console.log("Deposit Record PDA:", depositRecord.toBase58());

  // ✅ Ensure vault token account exists
  try {
    await getAccount(connection, vaultTokenAccount);
    console.log("Vault token account already exists ✅");
  } catch {
    console.log("Vault token account missing — creating...");
    const createVaultATAIx = createAssociatedTokenAccountInstruction(
      authority.publicKey, // payer
      vaultTokenAccount,   // new ATA
      vaultState,          // owner (PDA)
      TOKEN_MINT
    );
    const tx = new Transaction().add(createVaultATAIx);
    await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Vault token account created");
  }

  // 🏗️ Deposit instruction
  const amount = new BN(1_000_000_000); // 1 token

  console.log("getAssociatedTokenAddressSync(TOKEN_MINT, authority.publicKey),", getAssociatedTokenAddressSync(TOKEN_MINT, authority.publicKey).toBase58())
  const depositIx = await program.methods
    .deposit(orderId, amount)
    .accounts({
      user: authority.publicKey,
      userTokenAccount: getAssociatedTokenAddressSync(TOKEN_MINT, authority.publicKey),
      vaultState,
      vaultTokenAccount,
      depositRecord,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(depositIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log("✅ Deposit successful! Signature:", sig);

  try {
    const record = await program.account.depositRecord.fetch(depositRecord);
    console.log("📦 Deposit Record:", record);
  } catch (err) {
    console.warn("⚠️ Could not fetch record:", err.message);
  }
}

main().catch((err) => console.error("❌ Error:", err));
