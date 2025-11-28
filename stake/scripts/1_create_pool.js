import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- REAL PROGRAM ID ----------------
const PROGRAM_ID = new web3.PublicKey(
  "4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva"
);

// ---------------- LOCALNET CONNECTION ----------------
// const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");

// ---------------- ADMIN WALLET ----------------
const authority = web3.Keypair.fromSecretKey(
  bs58.decode(
    "3E4XK...MRJ"
  )
);

// ---------------- TOKEN MINTS (LOCALNET) ----------------
const TOKEN_MINT = new web3.PublicKey("Bjx9JFSyhHS8bkAKYMr56bPU43SWSawPK375cp2oj89G");
const REWARD_MINT = new web3.PublicKey("HKxsEnXoRne5DzuKB1wgrUhpBWL9i8SfkZpmi8MTgCJv");

// ---------------- PROVIDER + PROGRAM ----------------
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
  console.log("🪙 Token Mint:", TOKEN_MINT.toBase58());
  console.log("💎 Reward Mint:", REWARD_MINT.toBase58());

  // ---------------- CORRECT PDA SEEDS ----------------
  // pool = ["pool", token_mint]
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
);

const [poolVaultPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
);

const [rewardVaultPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("reward_vault"), REWARD_MINT.toBuffer()],
  PROGRAM_ID
);

  console.log("🏗 Pool PDA:", poolPda.toBase58());
  console.log("💰 Pool Vault PDA:", poolVaultPda.toBase58());
  console.log("💎 Reward Vault PDA:", rewardVaultPda.toBase58());

  // ---------------- EXECUTE createPool ----------------
  try {
    const rewardPercentage = 1000;

    const txSig = await program.methods
      .createPool(null, new BN(rewardPercentage))
      .accounts({
        pool: poolPda,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        admin: authority.publicKey,
        tokenMint: TOKEN_MINT,
        rewardMint: REWARD_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();

    console.log("✅ SUCCESS: Pool created!");
    console.log("🔗 Tx Signature:", txSig);
  } catch (err) {
    console.error("❌ ERROR creating pool:", err);
  }
}

main().catch(console.error);
