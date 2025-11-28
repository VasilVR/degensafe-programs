import * as anchor from "@project-serum/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey
} from "@solana/web3.js";
import bs58 from "bs58";

// Constants
const PROGRAM_ID = new PublicKey("4cCYbBAvp5Pou9XChxG4wfRMzSvajrXQjHdbevyEqXyG");
const VAULT_TOKEN_ACCOUNT = new PublicKey("79KZdFVr1KgXRVR7ENg1ap7Kk5w5kNc9Xo9cVxKXpHGV");
const MINT_ADDRESS = new PublicKey("E9aH9rz827WCGdpBGkp2DeNTyRqeac2JE97VY8jtSqFV"); // Replace with your actual mint

async function main() {
  // Load user's keypair (receiver of the withdrawal)
  const userKeypair = Keypair.fromSecretKey(
    bs58.decode("3E4XKUn8db...naLwUnXEnJJ46MRJ") // replace with your secret
  );

  // Set up connection, provider, and program
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(userKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load the program (minimal IDL containing withdraw instruction)
  const idl = {
    version: "0.1.0",
    name: "order_deposit",
    instructions: [
      {
        name: "withdraw",
        accounts: [
          { name: "caller", isMut: true, isSigner: true },
          { name: "receiverTokenAccount", isMut: true, isSigner: false },
          { name: "vaultTokenAccount", isMut: true, isSigner: false },
          { name: "vaultTokenAccountAuthority", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
        ],
      },
    ],
  };

  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // Derive the PDA for vault authority (seeds = [b"vault-authority"])
  const [vaultAuthorityPda, vaultBump] = await PublicKey.findProgramAddress(
    [Buffer.from("vault-authority")],
    PROGRAM_ID
  );

  console.log("Vault authority PDA:", vaultAuthorityPda.toBase58());

  // Find (or derive) associated token account for user
  const receiverTokenAccount = await getAssociatedTokenAddress(
    MINT_ADDRESS,
    userKeypair.publicKey
  );

  console.log("Receiver token account:", receiverTokenAccount.toBase58());

  // Send transaction
  try {
    const tx = await program.methods
      .withdraw()
      .accounts({
        caller: userKeypair.publicKey,
        receiverTokenAccount,
        vaultTokenAccount: VAULT_TOKEN_ACCOUNT,
        vaultTokenAccountAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userKeypair])
      .rpc();

    console.log("Withdraw transaction successful:", tx);
  } catch (err) {
    console.error("Withdraw transaction failed:", err);
  }
}

main().catch((err) => {
  console.error("Error running script:", err);
  process.exit(1);
});
