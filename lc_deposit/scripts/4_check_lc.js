import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import IDL from "./lcidl.js";

// 🟢 Local setup
const PROGRAM_ID = new PublicKey(IDL.address);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// 🟢 Wallet authority
const authority = Keypair.fromSecretKey(
  bs58.decode(
    "3E4XKUn8db...J46MRJ"
  )
);

// 🪙 LC Token Mint
const TOKEN_MINT = new PublicKey("FSfi7yKWk9A9NViNmMx2qKxuvsVFiCb2DUgqqjGewc4f");

// 🟢 Provider setup
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

const program = new Program(IDL, provider);

async function main() {
  // Derive PDA for vault
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log("VaultState PDA:", vaultState.toBase58());

  try {
    // ✅ Fetch vault state account
    const vault = await program.account.vaultState.fetch(vaultState);

    console.log("\n✅ Vault State found:");
    console.log("---------------------------");
    console.log("Authority:       ", vault.authority.toBase58());
    console.log("Token Mint:      ", vault.tokenMint.toBase58());
    console.log("Wallet Account:  ", vault.walletAccount.toBase58());
    console.log("Balance (tokens):", vault.balance.toString());
    console.log("---------------------------\n");
  } catch (e) {
    console.error("❌ Vault State not found or not initialized:", e);
  }
}

main().catch((err) => console.error("❌ Error calling check-lc-vault:", err));
