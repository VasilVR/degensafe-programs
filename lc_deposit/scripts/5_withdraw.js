import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./lcidl.js";

const PROGRAM_ID = new web3.PublicKey("BYZYa8ifZSoX2UjAu9X7ZaWhy6ZHkAq8kKEMksJFo9Ly");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");

// 🔑 Vault authority (admin)
const authority = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...KYnaLwUnXEnJJ46MRJ")
);

// 🪙 Replace with your token mint
const TOKEN_MINT = new web3.PublicKey("FSfi7yKWk9A9NViNmMx2qKxuvsVFiCb2DUgqqjGewc4f");

// 🧩 Setup Anchor provider + program
const provider = new AnchorProvider(
  connection,
  {
    publicKey: authority.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(authority);
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => tx.partialSign(authority));
      return txs;
    },
  },
  { commitment: "confirmed" }
);

const program = new Program(idl, provider);

async function main() {
  console.log("🧾 Admin:", authority.publicKey.toBase58());
  console.log("🪙 Mint:", TOKEN_MINT.toBase58());

  // ---------------- Derive PDAs ----------------
  const [vaultStatePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  // Fetch vault state
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const walletAccount = new web3.PublicKey(vaultState.walletAccount);

  // Derive ATAs
  const vaultTokenAta = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    vaultStatePda,
    true
  );
  const destinationAta = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    walletAccount,
    true
  );

  console.log("🏦 Vault State PDA:", vaultStatePda.toBase58());
  console.log("💰 Vault Token ATA:", vaultTokenAta.toBase58());
  console.log("📤 Destination ATA:", destinationAta.toBase58());

  // ---------------- Check Balances (Before) ----------------
  const vaultInfoBefore = await connection
    .getTokenAccountBalance(vaultTokenAta)
    .catch(() => ({ value: { uiAmount: 0 } }));
  const destInfoBefore = await connection
    .getTokenAccountBalance(destinationAta)
    .catch(() => ({ value: { uiAmount: 0 } }));

  console.log("Vault balance before:", vaultInfoBefore.value.uiAmount || 0);
  console.log("Dest balance before:", destInfoBefore.value.uiAmount || 0);

  // ---------------- Execute Withdraw ----------------
  const txSig = await program.methods
    .withdraw()
    .accounts({
      vaultState: vaultStatePda,
      vaultTokenAccount: vaultTokenAta,
      destinationTokenAccount: destinationAta,
      authority: authority.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([authority])
    .rpc();

  console.log("✅ Withdraw transaction sent!");
  console.log("🔗 Tx Signature:", txSig);

  // ---------------- Check Balances (After) ----------------
  await new Promise((r) => setTimeout(r, 2000));

  const vaultInfoAfter = await connection
    .getTokenAccountBalance(vaultTokenAta)
    .catch(() => ({ value: { uiAmount: 0 } }));
  const destInfoAfter = await connection
    .getTokenAccountBalance(destinationAta)
    .catch(() => ({ value: { uiAmount: 0 } }));

  console.log("Vault balance after:", vaultInfoAfter.value.uiAmount || 0);
  console.log("Dest balance after:", destInfoAfter.value.uiAmount || 0);
}

main().catch((err) => console.error("❌ Error:", err));
