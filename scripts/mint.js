import * as anchor from "@project-serum/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import bs58 from "bs58";

const idl = {"version":"0.1.0","name":"my_nft_program","instructions":[{"name":"createMint","accounts":[{"name":"payer","isMut":true,"isSigner":true},{"name":"mintAuthority","isMut":false,"isSigner":false},{"name":"mint","isMut":true,"isSigner":false},{"name":"tokenProgram","isMut":false,"isSigner":false},{"name":"systemProgram","isMut":false,"isSigner":false},{"name":"rent","isMut":false,"isSigner":false}],"args":[]},{"name":"setupTreasury","accounts":[{"name":"payer","isMut":true,"isSigner":true},{"name":"treasuryAuthority","isMut":false,"isSigner":false},{"name":"treasuryTokenAccount","isMut":true,"isSigner":false},{"name":"paymentMint","isMut":false,"isSigner":false},{"name":"tokenProgram","isMut":false,"isSigner":false},{"name":"associatedTokenProgram","isMut":false,"isSigner":false},{"name":"systemProgram","isMut":false,"isSigner":false},{"name":"rent","isMut":false,"isSigner":false}],"args":[]}]}

async function main() {
    const userKeypair = Keypair.fromSecretKey(
    bs58.decode('3E4XKU...wUnXEnJJ46MRJ')
  );
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(userKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Your deployed program ID
  const programId = new PublicKey("E5i3mg7xiYMm1ndrik1AaifBmrWgBdiixmTRpdm83ymj");

  // Load your IDL (replace with actual path or load dynamically)
  // const idl = await anchor.Program.fetchIdl(programId, provider);

  // Create program client from IDL
  const program = new anchor.Program(idl, programId, provider);

  // Derive PDAs
  const [mintAuthorityPda] = await PublicKey.findProgramAddress(
    [Buffer.from("mint_authority")],
    programId
  );

  const [mintPda] = await PublicKey.findProgramAddress(
    [Buffer.from("mint")],
    programId
  );

  const mintAccountInfo = await connection.getAccountInfo(mintPda);
    if (mintAccountInfo === null) {
      console.log("Mint not found. Creating mint...");
      const tx1 = await program.methods
        .createMint()
        .accounts({
          payer: provider.wallet.publicKey,
          mintAuthority: mintAuthorityPda,
          mint: mintPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log("✅ createMint tx:", tx1);
    } else {
      console.log("Mint already exists, skipping createMint.");
    }
  
     // --- TREASURY SETUP ---
  const [treasuryAuthorityPda] = await PublicKey.findProgramAddress(
    [Buffer.from("treasury")],
    programId
  );

  // This is the mint address of the payment token (e.g., USDC on devnet)
  const paymentMint = new PublicKey("fZfm3kg8rhSZoEb4wnPd7TDKnoTcVRKoJXWBJkEJWMi");

  const treasuryTokenAccount = await anchor.utils.token.associatedAddress({
    mint: paymentMint,
    owner: treasuryAuthorityPda,
  });

  const tx2 = await program.methods
    .setupTreasury()
    .accounts({
      payer: wallet.publicKey,
      treasuryAuthority: treasuryAuthorityPda,
      treasuryTokenAccount,
      paymentMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("setupTreasury tx:", tx2);
  console.log("Treasury Token Account:", treasuryTokenAccount.toBase58());
}

main().catch((err) => {
  console.error(err);
});


// Mint Authority PDA: 4KTD6GXGpa4jcF2KD7VXyqpBo744rdjZ1768sAh99vi2
// Mint PDA: ENtRePzs5mzfKz2u9AVcsEzc4hqaVfV3ovQSFLcdJe1K

// 2fwUwJ9BmKyTzqRc89nHe2rDsbyLxzyvDh3EEoPt4tLswnfF5SCQdpkTrpcjPXu5Ykdofq1gQUsqttijEj5nbabP

// Treasury Token Account: 5jaS1WRWwizunBaZoW4MDaPrteVCTBzFbwcmFo7rC3GY
// 5b3xLArCdZ64teYJUn5EPegf81yQBKjKqSGmR3SxDWYFkDzqnG5YkjUaHf8Jefxwc2ijUJDwud8Y3pcyXjYTXeHB