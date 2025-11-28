import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";
import {
    Connection,
    Keypair
} from "@solana/web3.js";
import bs58 from "bs58";

// ---------------- Config ----------------
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Admin / payer wallet
const admin = Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn...aLwUnXEnJJ46MRJ"
  )
);

// User wallet who will receive tokens
const user = Keypair.generate();

// Total supply for each token
const TOTAL_SUPPLY = 1_000_000_000_000; 

async function main() {
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("User:", user.publicKey.toBase58());

  // ---------------- Create staking token ----------------
  const stakingMint = await createMint(
    connection,
    admin,
    admin.publicKey, // mint authority
    null, // freeze authority
    6 // decimals
  );
  console.log("✅ Staking token mint:", stakingMint.toBase58());

  // Create user's token account for staking token
  const userStakingAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    admin, // payer
    stakingMint,
    user.publicKey
  );

  // Mint all staking tokens to user
  await mintTo(connection, admin, stakingMint, userStakingAccount.address, admin, TOTAL_SUPPLY);
  console.log(
    `💰 Minted ${TOTAL_SUPPLY / 10 ** 6} staking tokens to user:`,
    userStakingAccount.address.toBase58()
  );

  // ---------------- Create reward token ----------------
  const rewardMint = await createMint(
    connection,
    admin,
    admin.publicKey, // mint authority
    null, // freeze authority
    6 // decimals
  );
  console.log("✅ Reward token mint:", rewardMint.toBase58());

  // Create user's token account for reward token
  const userRewardAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    rewardMint,
    user.publicKey
  );

  // Mint all reward tokens to user
  await mintTo(connection, admin, rewardMint, userRewardAccount.address, admin, TOTAL_SUPPLY);
  console.log(
    `💰 Minted ${TOTAL_SUPPLY / 10 ** 6} reward tokens to user:`,
    userRewardAccount.address.toBase58()
  );

  console.log("\n✅ All done! User now has both staking and reward tokens.");
}

main().catch(console.error);
