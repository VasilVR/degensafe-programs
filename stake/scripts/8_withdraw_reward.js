import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const TOKEN_MINT = new web3.PublicKey("3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf");
const REWARD_MINT = new web3.PublicKey("DBAFL2LvR7BdjkpEVkWHU9CJ8cRrMwpWUBbD147fGHnj");

// ---------------- ADMIN ----------------
const authority = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...fWi6mKYnaLwUnXEnJJ46MRJ")
);

// ---------------- PROVIDER + PROGRAM ----------------
const provider = new AnchorProvider(
  connection,
  {
    publicKey: authority.publicKey,
    signTransaction: async (tx) => { tx.partialSign(authority); return tx; },
    signAllTransactions: async (txs) => { txs.forEach(tx => tx.partialSign(authority)); return txs; },
  },
  { commitment: "confirmed" }
);

const program = new Program(idl, provider);

async function main() {
  console.log("🧾 Admin:", authority.publicKey.toBase58());

  // ---------------- PDAs ----------------
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  const [rewardVaultPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), REWARD_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log("🏗 Pool PDA:", poolPda.toBase58());
  console.log("💎 Reward Vault PDA:", rewardVaultPda.toBase58());

  // ---------------- ADMIN REWARD ATA ----------------
  const adminRewardAta = await getAssociatedTokenAddress(REWARD_MINT, authority.publicKey);
  console.log("👛 Admin Reward ATA:", adminRewardAta.toBase58());

  // ---------------- AMOUNT TO WITHDRAW ----------------
  const withdrawAmount = new BN(4_000_000); // 5 reward tokens (6 decimals)

  // ---------------- EXECUTE withdrawReward ----------------
  try {
    const txSig = await program.methods
      .withdrawReward(withdrawAmount)
      .accounts({
        pool: poolPda,
        admin: authority.publicKey,
        rewardVault: rewardVaultPda,
        adminRewardAccount: adminRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    console.log("✅ Reward withdrawn successfully!");
    console.log("🔗 Tx:", txSig);
  } catch (err) {
    console.error("❌ ERROR withdrawing reward:", err);
  }
}

main().catch(console.error);
