import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const PROGRAM_ID = new PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const TOKEN_MINT = new PublicKey("3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf"); // pool mint
const OLD_REWARD_MINT = new PublicKey("DBAFL2LvR7BdjkpEVkWHU9CJ8cRrMwpWUBbD147fGHnj"); // old reward mint

// ---------------- ADMIN ----------------
const admin = Keypair.fromSecretKey(
  bs58.decode("3E4XK...fsChZZevfWi6mKYnaLwUnXEnJJ46MRJ")
);

// ---------------- PROVIDER + PROGRAM ----------------
const provider = new AnchorProvider(connection, {
  publicKey: admin.publicKey,
  signTransaction: async (tx) => { tx.partialSign(admin); return tx; },
  signAllTransactions: async (txs) => { txs.forEach(tx => tx.partialSign(admin)); return txs; },
}, { commitment: "confirmed" });

const program = new Program(idl, provider);

async function main() {
  console.log("🧾 Admin:", admin.publicKey.toBase58());

  // ---------------- POOL PDA ----------------
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log("🏗 Pool PDA:", poolPda.toBase58());

  // ---------------- REWARD VAULT PDA FOR OLD MINT ----------------
  const [rewardVaultPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), OLD_REWARD_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log("🏦 Old Reward Vault PDA:", rewardVaultPda.toBase58());

  // ---------------- EXECUTE update_reward_mint ----------------
  try {
    const txSig = await program.methods
      .updateRewardMint()
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        newRewardMint: OLD_REWARD_MINT,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Pool reward mint updated BACK to old reward mint!");
    console.log("🔗 Tx:", txSig);
  } catch (err) {
    console.error("❌ ERROR updating reward mint:", err);
  }
}

main().catch(console.error);
