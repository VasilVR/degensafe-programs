import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import { SplTokenVaultProgram } from "../../target/types/spl_token_vault_program";

/**
 * Basic test environment setup
 */
export interface BasicTestEnvironment {
  provider: anchor.AnchorProvider;
  program: Program<SplTokenVaultProgram>;
  authority: anchor.Wallet;
}

/**
 * Creates a token mint for testing
 * @param provider - The Anchor provider
 * @param authority - The wallet authority
 * @param decimals - Number of decimals for the token (default: 6)
 * @returns The created token mint public key
 */
export const createTestTokenMint = async (
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  decimals: number = 6
): Promise<anchor.web3.PublicKey> => {
  const tokenMintKeypair = anchor.web3.Keypair.generate();
  const tokenMint = await createMint(
    provider.connection,
    authority.payer,
    authority.publicKey,
    null,
    decimals,
    tokenMintKeypair
  );
  return tokenMint;
};

/**
 * Derives the vault state PDA
 * @param tokenMint - The token mint public key
 * @param programId - The program ID
 * @returns The vault state PDA and bump
 */
export const deriveVaultStatePda = (
  tokenMint: anchor.web3.PublicKey,
  programId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] => {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), tokenMint.toBuffer()],
    programId
  );
};

/**
 * Gets the vault token account address
 * @param tokenMint - The token mint public key
 * @param vaultStatePda - The vault state PDA
 * @returns The vault token account address
 */
export const getVaultTokenAccount = async (
  tokenMint: anchor.web3.PublicKey,
  vaultStatePda: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
  return await anchor.utils.token.associatedAddress({
    mint: tokenMint,
    owner: vaultStatePda,
  });
};

/**
 * Initializes a basic test setup with provider, program, and authority
 * @returns Basic test setup objects
 */
export const initializeTestEnvironment = () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .SplTokenVaultProgram as Program<SplTokenVaultProgram>;
  const authority = provider.wallet as anchor.Wallet;

  return { provider, program, authority };
};
