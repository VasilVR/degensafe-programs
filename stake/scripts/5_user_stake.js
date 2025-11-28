import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ------------------- CONFIG -------------------
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
// const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");

const authority = web3.Keypair.fromSecretKey(
  bs58.decode("3E4XKUn8d...nXEnJJ46MRJ")
);

const provider = new AnchorProvider(connection, authority, { commitment: "confirmed" });
const program = new Program(idl, provider);

// const TOKEN_MINT = new web3.PublicKey("3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf");
const user = web3.Keypair.fromSecretKey(
  bs58.decode("36Nxxj...M3WuruTKJ7sX")
);

const TOKEN_MINT = new web3.PublicKey("EaUzNGnhFDKfzpuiXD9wUAaTygQQ7Z7uS4EyzJZ7fAv2");

// ------------------- MAIN -------------------
async function main() {
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
  PROGRAM_ID
);

const [userStakePda] = web3.PublicKey.findProgramAddressSync(
  [Buffer.from("user_stake"), poolPda.toBuffer(), new PublicKey('DY1hB...z1Cnst6aZ9i1qa').toBuffer()],
  PROGRAM_ID
);


  try {
    // Call the on-chain view function `get_user_stake_info`
    
const userStakeInfo = await program.methods
  .getUserStakeWithReward()
  .accounts({
    userStake: userStakePda,
    pool: poolPda,
  })
  .view();

    console.log("\n====== USER STAKE INFO ======");
    console.log("Owner            :", userStakeInfo.owner.toBase58());
    console.log("Pool             :", userStakeInfo.pool.toBase58());
    console.log("Amount Staked    :", userStakeInfo.amount.toString());
    console.log("Total Earned     :", userStakeInfo.totalEarned.toString());
    console.log("Unclaimed        :", userStakeInfo.unclaimed.toString());
    console.log("Pending        :", userStakeInfo.pendingReward.toString());
    console.log(
      "Last Staked Time :",
      new Date(userStakeInfo.lastStakedTime.toNumber() * 1000).toISOString()
    );
    console.log("Bump             :", userStakeInfo.bump);
    console.log("==============================\n");
  } catch (err) {
    console.error("❌ ERROR fetching user stake info:", err);
  }
}

main().catch(console.error);
