
import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import {
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// --------------------------------------------------
// PROGRAM + CONNECTION
// --------------------------------------------------
const PROGRAM_ID = new web3.PublicKey(
  "4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva"
);

// const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");

// --------------------------------------------------
// ADMIN WALLET
// --------------------------------------------------
const authority = web3.Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn8db...UnXEnJJ46MRJ"
  )
);

// --------------------------------------------------
// MINTS
// --------------------------------------------------
// ---------------- TOKEN MINTS (Dev) ----------------
const TOKEN_MINT = new web3.PublicKey("Bjx9JFSyhHS8bkAKYMr56bPU43SWSawPK375cp2oj89G");
const REWARD_MINT = new web3.PublicKey("HKxsEnXoRne5DzuKB1wgrUhpBWL9i8SfkZpmi8MTgCJv");

// --------------------------------------------------
// PROVIDER + PROGRAM
// --------------------------------------------------
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
  console.log("💎 Reward Mint:", REWARD_MINT.toBase58());

  // --------------------------------------------------
  // PDAs — SAME PATTERN AS createPool SCRIPT
  // --------------------------------------------------
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

  // --------------------------------------------------
  // ADMIN ATA (REWARD TOKEN)
  // --------------------------------------------------
  const adminRewardAta = await getAssociatedTokenAddress(
    REWARD_MINT,
    authority.publicKey
  );

  console.log("👛 Admin Reward ATA:", adminRewardAta.toBase58());

  // --------------------------------------------------
  // DEPOSIT AMOUNT
  // --------------------------------------------------
const amount = new BN(100_000_000); // 100 tokens (6 decimals)


  // --------------------------------------------------
  // EXECUTE depositReward
  // --------------------------------------------------
  try {
    const txSig = await program.methods
      .depositReward(amount)
      .accounts({
        pool: poolPda,
        admin: authority.publicKey,
        adminRewardAccount: adminRewardAta,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    console.log("✅ SUCCESS: Reward deposited!");
    console.log("🔗 Tx:", txSig);
  } catch (err) {
    console.error("❌ ERROR depositing reward:", err);
  }
}

main().catch(console.error);
