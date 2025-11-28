import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
// const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

const USER = web3.Keypair.fromSecretKey(
  bs58.decode("36Nxxjcfjcsvy...3WuruTKJ7sX")
);

const ADMIN = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn...XEnJJ46MRJ")
);

const TOKEN_MINT = new web3.PublicKey("EaUzNGnhFDKfzpuiXD9wUAaTygQQ7Z7uS4EyzJZ7fAv2");
const REWARD_MINT = new web3.PublicKey("B5buRS1MpTXcxqCi2vVFetCwqAUD5Q158Hrfp2NdQULg");
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");

// ---------------- PROVIDER + PROGRAM ----------------
const provider = new AnchorProvider(connection, ADMIN, { commitment: "confirmed" });
const program = new Program(idl, provider);

async function main() {
  console.log("👤 User:", USER.publicKey.toBase58());

  // ---------------- User Token Accounts ----------------
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    ADMIN,
    TOKEN_MINT,
    USER.publicKey
  );
  const userRewardAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    ADMIN,
    REWARD_MINT,
    USER.publicKey
  );

  console.log("💰 User Stake Token Balance:", Number(userTokenAccount.amount) / 1e6);
  console.log("💎 User Reward Token Balance:", Number(userRewardAccount.amount) / 1e6);

  // ---------------- Pool PDAs ----------------
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

  // ---------------- Fetch Pool Info ----------------
  const poolData = await program.account.pool.fetch(poolPda);

  // Fetch reward vault balance
  const rewardVaultAccount = await connection.getTokenAccountBalance(rewardVaultPda);

  console.log("\n========= POOL INFO =========");
  console.log("Token Mint      :", poolData.tokenMint.toBase58());
  console.log("Reward Mint     :", poolData.rewardMint.toBase58());
  console.log("Owner           :", poolData.owner.toBase58());
  console.log("Total Staked    :", poolData.totalStaked.toString());
  console.log("Reward %        :", poolData.rewardPercentage.toString());
  console.log("Active          :", poolData.isActive);
  console.log("Reward Vault Bal:", Number(rewardVaultAccount.value.amount) / 1e6);
  console.log("=============================");
}

main().catch(console.error);
