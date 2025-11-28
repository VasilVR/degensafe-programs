import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { IDL as idl } from "./idl.js";

const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load wallet
const authority = Keypair.fromSecretKey(
  bs58.decode("3E4XKUn8dbN...KYnaLwUnXEnJJ46MRJ")
);

// Provider with signer
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
  const orderId = "CREATION_203";

  const [depositRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_record"), Buffer.from(orderId)],
    PROGRAM_ID
  );

  console.log("DepositRecord PDA:", depositRecord.toBase58());

  try {
    // ✅ simpler: directly fetch account data
    const data = await program.account.depositRecord.fetch(depositRecord);
    console.log("✅ Deposit Record found:");
    console.log(data);
  } catch (e) {
    console.error("❌ No deposit record found:", e);
  }

}

main().catch((err) => console.error("❌ Error calling check_deposit():", err));
