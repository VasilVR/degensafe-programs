import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StakeProgram } from "../target/types/stake_program";

// Test constants - use small values for fast tests
// The reward calculation logic is the same regardless of slot count
// Need enough slots to generate non-zero rewards with integer division
export const TEST_SLOTS_PER_PERIOD = 100; // Enough for measurable rewards

/**
 * Advances the blockchain by a specified number of slots.
 * Uses parallel transaction sending for speed.
 * @param provider Anchor provider
 * @param slots Number of slots to advance (capped at 100 for efficiency)
 */
export async function warpSlots(provider: any, slots: number) {
  const startSlot = await provider.connection.getSlot();

  // For test efficiency, send transactions in parallel batches
  const effectiveSlots = Math.min(slots, 100);
  const batchSize = 10;

  for (let i = 0; i < effectiveSlots; i += batchSize) {
    const batch = Math.min(batchSize, effectiveSlots - i);
    const promises = [];
    for (let j = 0; j < batch; j++) {
      const tx = new anchor.web3.Transaction();
      tx.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: provider.wallet.publicKey,
          lamports: 0,
        })
      );
      promises.push(provider.sendAndConfirm(tx, []));
    }
    await Promise.all(promises);
  }

  const endSlot = await provider.connection.getSlot();
  console.log(`   Warped ${endSlot - startSlot} slots (requested ${slots})`);
}

/**
 * Advances to a target slot by sending transactions.
 * Optimized for speed with parallel transaction batching.
 */
export async function advanceToSlot(
  provider: anchor.Provider,
  targetSlot: number
) {
  let currentSlot = await provider.connection.getSlot();
  const slotsNeeded = targetSlot - currentSlot;

  if (slotsNeeded <= 0) return;

  // Advance in batches of parallel transactions
  const batchSize = 5;
  while (currentSlot < targetSlot) {
    const remaining = targetSlot - currentSlot;
    const batch = Math.min(batchSize, remaining);

    const promises = [];
    for (let i = 0; i < batch; i++) {
      const tx = new anchor.web3.Transaction();
      tx.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: provider.wallet.publicKey,
          lamports: 0,
        })
      );
      promises.push(provider.sendAndConfirm(tx, []));
    }
    await Promise.all(promises);
    currentSlot = await provider.connection.getSlot();
  }
}

/**
 * Gets the initialized program, provider, and admin wallet
 */
export function getTestEnvironment() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StakeProgram as Program<StakeProgram>;
  const admin = provider.wallet;

  return { provider, program, admin };
}

/**
 * Helper to create pool_id bytes for PDA derivation
 * @param poolId The pool ID (u64)
 * @returns Buffer containing the little-endian bytes of the pool_id
 */
export function poolIdToBytes(poolId: number): Buffer {
  return Buffer.from(new Uint8Array(new BigUint64Array([BigInt(poolId)]).buffer));
}

/**
 * Derives the pool PDA for a given token mint and pool_id
 * @param programId The stake program ID
 * @param tokenMint The token mint public key
 * @param poolId The pool ID (defaults to 0 for backward compatibility)
 * @returns The pool PDA and bump seed
 */
export function getPoolPDA(
  programId: anchor.web3.PublicKey,
  tokenMint: anchor.web3.PublicKey,
  poolId: number = 0
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("staking_pool"), tokenMint.toBuffer(), poolIdToBytes(poolId)],
    programId
  );
}

/**
 * Derives the global config PDA
 */
export function getGlobalConfigPDA(
  programId: anchor.web3.PublicKey
): [anchor.web3.PublicKey, number] {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    programId
  );
}

/**
 * Initialize global config (call once per test suite)
 */
export async function initializeGlobalConfig(
  program: Program<StakeProgram>,
  admin: anchor.Wallet
): Promise<anchor.web3.PublicKey> {
  const [configPda] = getGlobalConfigPDA(program.programId);
  
  // Check if already initialized
  try {
    await program.account.globalConfig.fetch(configPda);
    return configPda;
  } catch {
    // Not initialized, create it
  }
  
  await program.methods
    .initializeConfig()
    .accounts({
      config: configPda,
      admin: admin.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  
  return configPda;
}

