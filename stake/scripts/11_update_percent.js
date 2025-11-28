import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const TOKEN_MINT = new web3.PublicKey("EaUzNGnhFDKfzpuiXD9wUAaTygQQ7Z7uS4EyzJZ7fAv2");

// ---------------- ADMIN ----------------
const admin = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn8..."));

// ---------------- PROVIDER + PROGRAM ----------------
const provider = new AnchorProvider(
  connection,
  {
    publicKey: admin.publicKey,
    signTransaction: async (tx) => { tx.partialSign(admin); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(tx => tx.partialSign(admin)); return txs; },
  },
  { commitment: "confirmed" }
);

const program = new Program(idl, provider);

async function main() {
  // ---------------- POOL PDA ----------------
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log("🏗 Pool PDA:", poolPda.toBase58());

  // ---------------- NEW REWARD PERCENTAGE ----------------
  const newPercentage = new BN(90000); // e.g., 15%

  // ---------------- EXECUTE update_reward_percentage ----------------
  try {
    const txSig = await program.methods
      .updateRewardPercentage(newPercentage)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log(`✅ Reward percentage updated to ${newPercentage.toString()}!`);
    console.log("🔗 Tx:", txSig);
  } catch (err) {
    console.error("❌ ERROR updating reward percentage:", err);
  }
}

main().catch(console.error);
