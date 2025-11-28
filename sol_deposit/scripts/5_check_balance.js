import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { IDL as idl } from "./idl.js";

const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load wallet
const authority = Keypair.fromSecretKey(
  bs58.decode("3E4XKUn8dbN...i6mKYnaLwUnXEnJJ46MRJ")
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
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    PROGRAM_ID
  );

  console.log("VaultState PDA:", vaultState.toBase58());

  try {
    // ✅ Fetch vault state account data directly
    const data = await program.account.vaultState.fetch(vaultState);

    console.log("✅ Vault State found:");
    console.log("Wallet Account:", data.walletAccount.toBase58());
    console.log("Balance (lamports):", data.balance.toString());
    console.log("Authority:", data.authority.toBase58());
  } catch (e) {
    console.error("❌ Vault State not found or not initialized:", e);
  }
}

main().catch((err) => console.error("❌ Error calling check():", err));
