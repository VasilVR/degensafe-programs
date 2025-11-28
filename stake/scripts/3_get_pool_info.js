import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// --------------------------------------------------
// PROGRAM + CONNECTION
// --------------------------------------------------
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");

// --------------------------------------------------
// ADMIN WALLET (only needed for provider)
// --------------------------------------------------
const authority = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...nXEnJJ46MRJ")
);

// --------------------------------------------------
// PROVIDER + PROGRAM
// --------------------------------------------------
const provider = new AnchorProvider(
  connection,
  {
    publicKey: authority.publicKey,
    signTransaction: async (tx) => { tx.partialSign(authority); return tx; },
    signAllTransactions: async (txs) => { txs.forEach((tx) => tx.partialSign(authority)); return txs; },
  },
  { commitment: "confirmed" }
);

const program = new Program(idl, provider);
const TOKEN_MINT = new web3.PublicKey("Bjx9JFSyhHS8bkAKYMr56bPU43SWSawPK375cp2oj89G");

// --------------------------------------------------
// MAIN FUNCTION
// --------------------------------------------------
async function main() {
  console.log("📌 Fetching Pool Info...");

  // ONLY POOL PDA IS NEEDED
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
  );

  console.log("🏗 Pool PDA:", poolPda.toBase58());

  try {
    // ONLY POOL ACCOUNT REQUIRED
    const data = await program.methods
      .getPoolInfo()
      .accounts({ pool: poolPda })
      .view();

    console.log("\n========= POOL INFO =========");
    console.log("Token Mint      :", data.tokenMint.toBase58());
    console.log("Reward Mint     :", data.rewardMint.toBase58());
    console.log("Reward Vault    :", data.rewardVault.toBase58());
    console.log("Owner           :", data.owner.toBase58());
    console.log("Total Staked    :", data.totalStaked.toString());
    console.log("Reward %        :", data.rewardPercentage.toString());
    console.log("Active          :", data.isActive);
    console.log("Bump            :", data.bump);
    console.log("=============================\n");

  } catch (err) {
    console.error("❌ ERROR:", err);
  }
}

main().catch(console.error);
