import { Program } from "@coral-xyz/anchor";
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
    Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import IDL from "./lcidl.js"; // Your vault program IDL

// 🟢 Setup connection + constants
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const PROGRAM_ID = new PublicKey(IDL.address);

// 🧾 Admin keypair
const admin = Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn8dbNG...mKYnaLwUnXEnJJ46MRJ"
  )
);

// 🪙 Token mint used in vault (from init script output)
const TOKEN_MINT = new PublicKey("FSfi7yKWk9A9NViNmMx2qKxuvsVFiCb2DUgqqjGewc4f");

// 🆕 New wallet to set for withdrawals
const NEW_WALLET = new PublicKey("DY1hBB1ZZNbtpqnx5hyJ8uWH9eFzCbz1Cnst6aZ9i1qa");

const program = new Program(IDL, { connection });

async function main() {
  console.log("Admin:", admin.publicKey.toBase58());

  // 🧩 Derive PDA for vault
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  // 📦 Compute associated token account for new wallet
  const ata = getAssociatedTokenAddressSync(TOKEN_MINT, NEW_WALLET);

  console.log("VaultState PDA:", vaultState.toBase58());
  console.log("New Wallet:", NEW_WALLET.toBase58());
  console.log("Expected ATA:", ata.toBase58());

  // 🏗️ Build transaction
  const ix = await program.methods
    .setWithdrawalAccount(NEW_WALLET)
    .accounts({
      vaultState,
      authority: admin.publicKey,
      newWallet: NEW_WALLET,
      associatedToken: ata,
      tokenMint: TOKEN_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  console.log("✅ Withdrawal wallet set successfully!");
  console.log("Signature:", sig);
}

main().catch(console.error);
