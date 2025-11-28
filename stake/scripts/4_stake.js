import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import idl from "./stakeidl.js";

// ---------------- CONFIG ----------------
const PROGRAM_ID = new web3.PublicKey("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");
const TOKEN_MINT = new web3.PublicKey("3rd8ccCdHzWdPVXTvtPvzh6uS81N49nnJvfeiphMVUmf");
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");

// ---------------- ADMIN ----------------
const admin = web3.Keypair.fromSecretKey(bs58.decode(
  "3E4XKU...XEnJJ46MRJ"
));

// ---------------- USER ----------------
const user = web3.Keypair.fromSecretKey(bs58.decode(
  "36Nxxjcfj...M3WuruTKJ7sX"
));

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

async function main() {
  console.log("👤 User:", user.publicKey.toBase58());
const airdropSig = await connection.requestAirdrop(user.publicKey, 2_000_000_000); // 2 SOL
await connection.confirmTransaction(airdropSig, "confirmed");
  // ---------------- PDAs ----------------
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [poolVaultPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [userStakePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), poolPda.toBuffer(), user.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log("🏗 Pool PDA:", poolPda.toBase58());
  console.log("💰 Pool Vault PDA:", poolVaultPda.toBase58());
  console.log("📝 User Stake PDA:", userStakePda.toBase58());

  // ---------------- Ensure user ATA ----------------
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,          // payer
    TOKEN_MINT,     // mint
    user.publicKey  // owner
  );
  console.log("👛 User Token ATA:", userTokenAccount.address.toBase58());

  // ---------------- Mint tokens to user ----------------
  const depositAmount = new BN(500_000_000); // 500 tokens (6 decimals)
  await mintTo(
    connection,
    admin,                     // fee payer
    TOKEN_MINT,                // mint
    userTokenAccount.address,  // destination
    admin,                     // mint authority
    depositAmount.toNumber()
  );
  console.log(`✅ Minted ${depositAmount.toNumber() / 1e6} tokens to user`);

  // ---------------- Deposit stake ----------------
  try {
    const tx = await program.methods
      .depositStake(depositAmount)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    console.log("✅ Stake deposited!");
    console.log("🔗 Tx:", tx);
  } catch (err) {
    console.error("❌ ERROR depositing stake:", err);
  }

  // ---------------- Fetch user stake account ----------------
  const userStake = await program.account.userStake.fetch(userStakePda);
  console.log("📊 User stake info:", {
    owner: userStake.owner.toBase58(),
    pool: userStake.pool.toBase58(),
    amount: userStake.amount.toString(),
    totalEarned: userStake.totalEarned.toString(),
    lastStakedTime: new Date((userStake.lastStakedTime) * 1000).toISOString(),
  });
}

main().catch(console.error);
