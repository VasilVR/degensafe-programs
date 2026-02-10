import { EventParser } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplTokenVaultProgram } from "../../target/types/spl_token_vault_program";

/**
 * Helper function to parse events from a transaction
 * @param program - The Anchor program instance
 * @param txDetails - Transaction details returned from getTransaction()
 * @returns Array of parsed events
 */
export const getEventsFromTransaction = (
  program: Program<SplTokenVaultProgram>,
  txDetails: any
) => {
  if (!txDetails || !txDetails.meta || !txDetails.meta.logMessages) {
    return [];
  }
  const eventParser = new EventParser(program.programId, program.coder);
  // parseLogs returns a generator, so we need to convert it to an array
  return Array.from(eventParser.parseLogs(txDetails.meta.logMessages));
};
