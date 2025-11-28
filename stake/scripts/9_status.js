import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const TOKEN_MINT = new web3.PublicKey("3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf");

// ---------------- ADMIN ----------------
const admin = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...KYnaLwUnXEnJJ46MRJ")
);

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

// ---------------- MAIN ----------------
async function main() {
  // ---------------- POOL PDA ----------------
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log("🏗 Pool PDA:", poolPda.toBase58());

  // ---------------- ENABLE / DISABLE ----------------
  const enable = true; // set false to disable

  try {
    const txSig = await program.methods
      .setStakingActive(enable)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log(`✅ Pool staking is now ${enable ? "enabled" : "disabled"}!`);
    console.log("🔗 Tx:", txSig);
  } catch (err) {
    console.error("❌ ERROR updating pool state:", err);
  }
}

main().catch(console.error);
