import * as anchor from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";

// Program ID
const PROGRAM_ID = new PublicKey("4cCYbBAvp5Pou9XChxG4wfRMzSvajrXQjHdbevyEqXyG");

// User wallet keypair
  const userKeypair = Keypair.fromSecretKey(
    bs58.decode('3E4XKUn8dbNG1...JJ46MRJ')
  );

// Setup provider
const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(userKeypair);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);

// Define minimal IDL to deserialize depositAccount
const idl = {
  version: "0.1.0",
  name: "order_deposit",
  instructions: [],
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
          { name: "amount", type: "u64" }  // <-- added amount here
        ]
      }
    }
  ]
};

// Load program
const program = new anchor.Program(idl, PROGRAM_ID, provider);

async function main() {
  const orderId = "6f5e09da-3e6b-4a78-8";
  const nonce = new BN(1760358787399); 
  
  const [depositPda] = await PublicKey.findProgramAddress(
    [
      Buffer.from(orderId),
      nonce.toArrayLike(Buffer, "le", 8)
    ],
    PROGRAM_ID
  );

  console.log("Deposit PDA:", depositPda.toBase58());

  try {
    const depositAccount = await program.account.depositAccount.fetch(depositPda);

    console.log("Deposit account found:");
    console.log("Order ID:", depositAccount.orderId);
    console.log("Nonce:", depositAccount.nonce.toString());
    console.log("Exists:", depositAccount.exists);
    console.log("Timestamp:", new Date(depositAccount.timestamp.toNumber() * 1000).toISOString());
    console.log("User:", depositAccount.user.toBase58());
    console.log("Amount:", depositAccount.amount.toString());  // <-- print amount here
  } catch (err) {
    console.error("No deposit account found or fetch failed.");
    console.error(err.message || err);
  }
}


main();
