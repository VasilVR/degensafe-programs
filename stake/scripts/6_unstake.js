import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const PROGRAM_ID = new web3.PublicKey(
  "4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva"
);
const TOKEN_MINT = new web3.PublicKey(
  "3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf"
);
const REWARD_MINT = new web3.PublicKey(
  "DBAFL2LvR7BdjkpEVkWHU9CJ8cRrMwpWUBbD147fGHnj"
);
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");

// ---------------- ADMIN ----------------
const admin = web3.Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn...nXEnJJ46MRJ"
  )
);

// ---------------- USER ----------------
const user = web3.Keypair.fromSecretKey(
  bs58.decode(
    "36Nxxjcfj...3WuruTKJ7sX"
  )
);

// ---------------- PROVIDER + PROGRAM ----------------
const provider = new AnchorProvider(
  connection,
  {
    publicKey: admin.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(admin);
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => tx.partialSign(admin));
      return txs;
    },
  },
  { commitment: "confirmed" }
);
const program = new Program(idl, provider);

async function main() {
  console.log("👤 User:", user.publicKey.toBase58());

  // ---------------- PDAs ----------------
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
  const [userStakePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), poolPda.toBuffer(), user.publicKey.toBuffer()],
    PROGRAM_ID
  );

  // ---------------- User token accounts ----------------
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,          // payer
    TOKEN_MINT,
    user.publicKey
  );
  const userRewardAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,          // payer
    REWARD_MINT,
    user.publicKey
  );

  console.log("👛 User Token ATA:", userTokenAccount.address.toBase58());
  console.log("👛 User Reward ATA:", userRewardAccount.address.toBase58());

  // ---------------- Withdraw stake ----------------
  const withdrawAmount = new BN(250_000_000); // 250 tokens (6 decimals)

  try {
    const tx = await program.methods
      .withdrawStake(withdrawAmount)
      .accounts({
        pool: poolPda,
        userStake: userStakePda,
        user: user.publicKey,
        userTokenAccount: userTokenAccount.address,
        userRewardAccount: userRewardAccount.address,
        poolVault: poolVaultPda,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log("✅ Stake withdrawn!");
    console.log("🔗 Tx:", tx);
  } catch (err) {
    console.error("❌ ERROR withdrawing stake:", err);
  }

  // ---------------- Fetch user stake account ----------------
  const userStake = await program.account.userStake.fetch(userStakePda);
  console.log("📊 User stake info after withdrawal:", {
    owner: userStake.owner.toBase58(),
    pool: userStake.pool.toBase58(),
    amount: userStake.amount.toString(),
    totalEarned: userStake.totalEarned.toString(),
    unclaimed: userStake.unclaimed.toString(),
    lastStakedTime: new Date(userStake.lastStakedTime * 1000).toISOString(),
  });
}

main().catch(console.error);
