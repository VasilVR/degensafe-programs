import * as anchor from "@coral-xyz/anchor";
import { Program, EventParser } from "@coral-xyz/anchor";
import { SolVaultProgram } from "../../target/types/sol_vault_program";

/**
 * Helper function to parse events from transaction
 * @param program The Anchor program instance
 * @param txDetails Transaction details with log messages
 * @returns Array of parsed events
 */
export const getEventsFromTransaction = (
  program: Program<SolVaultProgram>,
  txDetails: any
) => {
  if (!txDetails || !txDetails.meta || !txDetails.meta.logMessages) {
    return [];
  }
  const eventParser = new EventParser(program.programId, program.coder);
  // parseLogs returns a generator, so we need to convert it to an array
  return Array.from(eventParser.parseLogs(txDetails.meta.logMessages));
};

/**
 * Gets the initialized program, provider, and authority wallet
 */
export function getTestEnvironment() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .SolVaultProgram as Program<SolVaultProgram>;
  const authority = provider.wallet as anchor.Wallet;

  return { provider, program, authority };
}

/**
 * Derives the vault state PDA
 */
export function getVaultStatePda(programId: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    programId
  );
}

/**
 * Derives the vault PDA
 */
export function getVaultPda(programId: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_pda")],
    programId
  );
}

/**
 * Derives the deposit record PDA
 */
export function getDepositRecordPda(
  depositor: anchor.web3.PublicKey,
  orderId: string,
  programId: anchor.web3.PublicKey
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_record"), depositor.toBuffer(), Buffer.from(orderId)],
    programId
  );
}

/**
 * Ensures the vault is initialized. If it already exists, skips initialization.
 * This is useful for test files that run in parallel and share the same vault PDA.
 * @param program The Anchor program instance
 * @param vaultStatePda The vault state PDA
 * @param authority The authority wallet
 */
export async function ensureVaultInitialized(
  program: Program<SolVaultProgram>,
  vaultStatePda: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey
) {
  try {
    // Check if vault already exists
    await program.account.vaultState.fetch(vaultStatePda);
    // Vault already initialized, skip
    console.log("Vault already initialized, skipping initialization");
  } catch (err) {
    // Vault doesn't exist, initialize it
    await program.methods
      .initialize()
      .accounts({
        vaultState: vaultStatePda,
        authority: authority,
      })
      .rpc();
    console.log("Vault initialized successfully");
  }
}
