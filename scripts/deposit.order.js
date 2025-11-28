import * as anchor from "@project-serum/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from 'bn.js';
import bs58 from 'bs58';

// Your program ID from Anchor deploy
const PROGRAM_ID = new PublicKey("4cCYbBAvp5Pou9XChxG4wfRMzSvajrXQjHdbevyEqXyG");

// Vault token account (your given)
const VAULT_TOKEN_ACCOUNT = new PublicKey("79KZdFVr1KgXRVR7ENg1ap7Kk5w5kNc9Xo9cVxKXpHGV");

// Constants
const PRICE = 2_000_000; // 2 tokens with 9 decimals

async function main() {
  // Load wallet keypair
  const userKeypair = Keypair.fromSecretKey(
    bs58.decode('3E4XKUn8db...naLwUnXEnJJ46MRJ')
  );


  // Setup provider and program
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");

const wallet = new anchor.Wallet(userKeypair);

const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});

  const anchorProvider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });

  anchor.setProvider(anchorProvider);

  // Load the IDL (You can generate it from your Anchor project)
  // For simplicity, using a minimal IDL here matching your program:
  const idl = {
    version: "0.1.0",
    name: "order_deposit",
    instructions: [
      {
        name: "deposit",
        accounts: [
          { name: "user", isMut: true, isSigner: true },
          { name: "userTokenAccount", isMut: true, isSigner: false },
          { name: "vaultTokenAccount", isMut: true, isSigner: false },
          { name: "depositAccount", isMut: true, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "rent", isMut: false, isSigner: false },
        ],
        args: [
          { name: "orderId", type: "string" },
          { name: "nonce", type: "u64" },
        ],
      },
    ],
    accounts: [
      {
        name: "depositAccount",
        type: {
          kind: "struct",
          fields: [
            { name: "orderId", type: "string" },
            { name: "nonce", type: "u64" },
            { name: "timestamp", type: "i64" },
            { name: "exists", type: "bool" },
            { name: "user", type: "publicKey" },
          ],
        },
      },
    ],
  };

  // Create program interface
  const program = new anchor.Program(idl, PROGRAM_ID, anchorProvider);

  // Your input parameters
  const orderId = "my-order-13";
  const nonce = new BN(1);

  // Derive the PDA for deposit_account
  const [depositPda, bump] = await PublicKey.findProgramAddress(
    [
      Buffer.from(orderId),
      nonce.toArrayLike(Buffer, "le", 8), // nonce u64 LE bytes
    ],
    PROGRAM_ID
  );

  console.log("Deposit PDA:", depositPda.toBase58());

  // Find user's token account for the mint (assuming you have the mint address)
  // For example, let's say the mint is known:
  const MINT_ADDRESS = new PublicKey("E9aH9rz827WCGdpBGkp2DeNTyRqeac2JE97VY8jtSqFV"); // replace with actual mint address

  // Fetch user's token accounts and find one with the mint
  const userTokenAccounts = await connection.getTokenAccountsByOwner(
    userKeypair.publicKey,
    { mint: MINT_ADDRESS }
  );

  if (userTokenAccounts.value.length === 0) {
    throw new Error("User token account for this mint not found");
  }

  // Use the first token account for simplicity
  const userTokenAccount = new PublicKey(userTokenAccounts.value[0].pubkey);

  console.log("User token account:", userTokenAccount.toBase58());

  // Now send the transaction
  try {
    const tx = await program.methods
      .deposit(orderId, nonce)
      .accounts({
        user: userKeypair.publicKey,
        userTokenAccount,
        vaultTokenAccount: VAULT_TOKEN_ACCOUNT,
        depositAccount: depositPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([])
      .rpc();

    console.log("Transaction successful:", tx);
  } catch (error) {
    console.error("Transaction failed:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
