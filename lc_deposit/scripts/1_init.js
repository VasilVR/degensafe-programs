import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction
} from "@solana/web3.js";
import bs58 from "bs58";
import IDL from "./lcidl.js";

// 🟢 Program + RPC
const PROGRAM_ID = new PublicKey(IDL.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// 🟢 Wallet authority
const authority = Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn8dbNG...mKYnaLwUnXEnJJ46MRJ"
  )
);

const TOKEN_MINT = new PublicKey("FSfi7yKWk9A9NViNmMx2qKxuvsVFiCb2DUgqqjGewc4f");

// 🟢 Anchor provider + program
const provider = new AnchorProvider(connection, { publicKey: authority.publicKey }, {});
const program = new Program(IDL, provider);

// 🧩 Derive PDAs
const [vaultState] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_state"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
);

const vaultTokenAccount = getAssociatedTokenAddressSync(
  TOKEN_MINT,
  vaultState,
  true // PDA authority allowed
);

async function main() {
  console.log("Vault State PDA:", vaultState.toBase58());
  console.log("Vault Token ATA:", vaultTokenAccount.toBase58());

  // 🏗️ Build initialize instruction
  const ix = await program.methods
    .initialize()
    .accounts({
      vaultState,
      vaultTokenAccount,
      authority: authority.publicKey,
      tokenMint: TOKEN_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  // 🧾 Send tx
  const tx = new Transaction().add(ix);
  const txSig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log("✅ Initialized LC Vault:", txSig);

  // 🔍 Fetch vault state
  const vault = await program.account.vaultState.fetch(vaultState);
  console.log("🏦 Vault initialized:", vault);
}

main().catch((err) => {
  console.error("❌ Error initializing LC vault:", err);
});
