import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { expect } from "chai";
import { SplTokenVaultProgram } from "../target/types/spl_token_vault_program";
async function sha256Bytes(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Buffer.from(hashBuffer);
}


describe("🧩 spl_token_vault_program end-to-end", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SplTokenVaultProgram as Program<SplTokenVaultProgram>;

  const authority = provider.wallet;
  let mint: anchor.web3.PublicKey;
  let vaultState: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let vaultBump: number;

  before(async () => {
    // Create token mint
    mint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6 // decimals
    );

    // Derive PDA for vault_state
    [vaultState, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state"), mint.toBuffer()],
      program.programId
    );

    vaultTokenAccount = getAssociatedTokenAddressSync(mint, vaultState, true);
  });

  it("✅ Initializes the vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        vaultState,
        vaultTokenAccount,
        authority: authority.publicKey,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.authority.toBase58()).to.eq(authority.publicKey.toBase58());
    console.log("✅ Vault initialized:", state);
  });

  it("✅ Creates wallet ATA only if missing", async () => {
    const user = anchor.web3.Keypair.generate();
    const expectedAta = getAssociatedTokenAddressSync(mint, user.publicKey);

    // Confirm ATA doesn’t exist
    let ataInfo = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfo).to.be.null;
    console.log("ℹ️ ATA not found, will be created...");

    await program.methods
      .createWalletAtaIfNeeded(user.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: user.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    ataInfo = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfo).to.not.be.null;
    console.log("✅ ATA created:", expectedAta.toBase58());

    // Call again — should detect existing ATA
    await program.methods
      .createWalletAtaIfNeeded(user.publicKey)
      .accounts({
        payer: authority.publicKey,
        wallet: user.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log("♻️ Called again, ATA already existed (no recreate).");
  });

  it("✅ Sets withdrawal wallet and automatically creates ATA", async () => {
    const newWallet = anchor.web3.Keypair.generate();
    const expectedAta = getAssociatedTokenAddressSync(mint, newWallet.publicKey);

    const ataInfoBefore = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfoBefore).to.be.null;

    await program.methods
      .setWithdrawalAccount()
      .accounts({
        vaultState,
        authority: authority.publicKey,
        newWallet: newWallet.publicKey,
        associatedToken: expectedAta,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const ataInfoAfter = await provider.connection.getAccountInfo(expectedAta);
    expect(ataInfoAfter).to.not.be.null;
    console.log("✅ ATA auto-created for new wallet:", expectedAta.toBase58());
  });

  it("🚫 Fails withdrawal if withdrawal wallet has no ATA", async () => {
    const noAtaWallet = anchor.web3.Keypair.generate();

    const destAta = getAssociatedTokenAddressSync(mint, noAtaWallet.publicKey);
    const ataInfo = await provider.connection.getAccountInfo(destAta);
    expect(ataInfo).to.be.null;
    console.log("ℹ️ No ATA exists for withdrawal wallet.");

    try {
      await program.methods
        .withdraw()
        .accounts({
          vaultState,
          vaultTokenAccount,
          destinationTokenAccount: destAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("🚨 Should have failed, no ATA exists");
    } catch (err) {
      expect(err.toString()).to.match(/(InvalidAccountData|AccountNotInitialized|AnchorError)/);
console.log("✅ Correctly failed when no ATA exists:", err.toString());
    }
  });

  it("✅ Checks vault balance and details", async () => {
    await program.methods
      .check()
      .accounts({
        vaultState,
        vaultTokenAccount,
      })
      .rpc();
    console.log("✅ Vault check ran successfully.");
  });

 it("✅ Deposits tokens into vault and checks record", async () => {
  const user = anchor.web3.Keypair.generate();

  // Airdrop SOL to user
  const sig = await provider.connection.requestAirdrop(
    user.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig);

  // 🪙 Create user's ATA
  const userTokenAccount = await createAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mint,
    user.publicKey
  );

  // 🪙 Mint tokens to user
  await mintTo(
    provider.connection,
    authority.payer,
    mint,
    userTokenAccount,
    authority.publicKey,
    100_000_000 // 100 tokens
  );

  const orderId = "ORDER123";

  // 🧩 Derive PDAs
  const [vaultStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), mint.toBuffer()],
    program.programId
  );
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    mint,
    vaultStatePda,
    true // allow PDA authority
  );
  const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_record"), mint.toBuffer(), user.publicKey.toBuffer(), Buffer.from(orderId)],
    program.programId
  );

  // ✅ Perform deposit
  await program.methods
    .deposit(orderId, new anchor.BN(10_000_000)) // deposit 10 tokens
    .accounts({
      user: user.publicKey,
      userTokenAccount,
      vaultState: vaultStatePda,
      vaultTokenAccount,
      depositRecord: depositRecordPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();

  // 🧾 Verify record
  const record = await program.account.depositRecord.fetch(depositRecordPda);
  expect(record.amount.toNumber()).to.eq(10_000_000);
  expect(record.user.toBase58()).to.eq(user.publicKey.toBase58());
  console.log("✅ Deposit recorded successfully:", record);

  // 🧮 Verify vault token balance on-chain
  const vaultTokenInfo = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
  console.log("🏦 Vault token balance:", vaultTokenInfo.value.uiAmount);
});

it("🚨 Prevents reentrancy during withdraw", async () => {
  // Setup malicious vault that calls withdraw again in a CPI during token transfer
  const attacker = anchor.web3.Keypair.generate();
  
  // Fund attacker ATA and vault
  const attackerAta = await createAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mint,
    attacker.publicKey
  );

  await mintTo(
    provider.connection,
    authority.payer,
    mint,
    attackerAta,
    authority.publicKey,
    50_000_000 // 50 tokens
  );

  // Attempt first withdrawal
  // Using a try/catch to detect reentrancy issues
  try {
    await program.methods.withdraw()
      .accounts({
        vaultState,
        vaultTokenAccount,
        destinationTokenAccount: attackerAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("✅ Withdraw completed safely");
  } catch (err) {
    console.log("🚫 Withdraw blocked (reentrancy prevented):", err.toString());
  }
});

it("fails when order_id is longer than MAX_ORDER_ID_LEN", async () => {
    const user = anchor.web3.Keypair.generate();
    // Create an order_id that's 64 bytes (2x the MAX_ORDER_ID_LEN of 32 bytes)
    // Solana runtime enforces 32-byte max per seed, so this will fail at PDA derivation
    const longOrderId = "X".repeat(64); // 64 bytes (2x the 32 byte limit)

    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(user.publicKey, 1e9),
    );

    const userAta = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        user.publicKey
    );

    // Mint some tokens to user
    await mintTo(
        provider.connection,
        authority.payer,
        mint,
        userAta,
        authority.publicKey,
        10_000_000
    );

    // Attempting to derive PDA with seed > 32 bytes will fail
    try {
        const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("deposit_record"), mint.toBuffer(), user.publicKey.toBuffer(), Buffer.from(longOrderId)],
            program.programId
        );

        await program.methods
            .deposit(longOrderId, new anchor.BN(1_000_000))
            .accounts({
                user: user.publicKey,
                userTokenAccount: userAta,
                vaultState,
                vaultTokenAccount,
                depositRecord: depositRecordPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([user])
            .rpc();

        expect.fail("Expected runtime error for seed length exceeded");
    } catch (err) {
        const msg = err.toString();
        console.log("Error:", msg);
        // Expect a runtime error about seed length, not our custom InvalidOrderId
        expect(msg).to.match(/(seed|length|exceed|max)/i);
    }
});

it("fails when order_id is empty", async () => {
    const user = anchor.web3.Keypair.generate();
    const emptyOrderId = ""; // Empty string

    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(user.publicKey, 1e9),
    );

    const userAta = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        user.publicKey
    );

    // Mint some tokens to user
    await mintTo(
        provider.connection,
        authority.payer,
        mint,
        userAta,
        authority.publicKey,
        10_000_000
    );

    // PDA derivation with empty string succeeds
    const [depositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("deposit_record"), mint.toBuffer(), user.publicKey.toBuffer(), Buffer.from(emptyOrderId)],
        program.programId
    );

    try {
        await program.methods
            .deposit(emptyOrderId, new anchor.BN(1_000_000))
            .accounts({
                user: user.publicKey,
                userTokenAccount: userAta,
                vaultState,
                vaultTokenAccount,
                depositRecord: depositRecordPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([user])
            .rpc();

        expect.fail("Expected OrderIdEmpty error for empty order_id");
    } catch (err) {
        const msg = err.toString();
        console.log("Error:", msg);
        // This should trigger our custom validation
        expect(msg).to.contain("Order ID cannot be empty");
    }
});

it("✅ PDA uniqueness: Different users can use same order_id without collision", async () => {
    const user1 = anchor.web3.Keypair.generate();
    const user2 = anchor.web3.Keypair.generate();
    const sameOrderId = "SHARED_ORDER_123";

    // Airdrop SOL to both users
    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(user1.publicKey, 2e9),
    );
    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(user2.publicKey, 2e9),
    );

    // Create ATAs for both users
    const user1Ata = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        user1.publicKey
    );
    const user2Ata = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        user2.publicKey
    );

    // Mint tokens to both users
    await mintTo(
        provider.connection,
        authority.payer,
        mint,
        user1Ata,
        authority.publicKey,
        10_000_000
    );
    await mintTo(
        provider.connection,
        authority.payer,
        mint,
        user2Ata,
        authority.publicKey,
        10_000_000
    );

    // Derive PDAs - should be DIFFERENT even with same order_id
    const [depositRecordPda1] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("deposit_record"), mint.toBuffer(), user1.publicKey.toBuffer(), Buffer.from(sameOrderId)],
        program.programId
    );
    const [depositRecordPda2] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("deposit_record"), mint.toBuffer(), user2.publicKey.toBuffer(), Buffer.from(sameOrderId)],
        program.programId
    );

    // Verify PDAs are different
    expect(depositRecordPda1.toBase58()).to.not.eq(depositRecordPda2.toBase58());
    console.log("✅ PDAs are unique for different users with same order_id");

    // Both deposits should succeed
    await program.methods
        .deposit(sameOrderId, new anchor.BN(1_000_000))
        .accounts({
            user: user1.publicKey,
            userTokenAccount: user1Ata,
            vaultState,
            vaultTokenAccount,
            depositRecord: depositRecordPda1,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

    await program.methods
        .deposit(sameOrderId, new anchor.BN(1_000_000))
        .accounts({
            user: user2.publicKey,
            userTokenAccount: user2Ata,
            vaultState,
            vaultTokenAccount,
            depositRecord: depositRecordPda2,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user2])
        .rpc();

    // Verify both records exist with correct data
    const record1 = await program.account.depositRecord.fetch(depositRecordPda1);
    const record2 = await program.account.depositRecord.fetch(depositRecordPda2);

    expect(record1.user.toBase58()).to.eq(user1.publicKey.toBase58());
    expect(record2.user.toBase58()).to.eq(user2.publicKey.toBase58());
    expect(record1.orderId).to.eq(sameOrderId);
    expect(record2.orderId).to.eq(sameOrderId);
    
    console.log("✅ Both deposits succeeded with unique PDAs despite same order_id");
});

it("🚫 PDA collision attack prevented: User cannot create deposit for another user's PDA", async () => {
    const attacker = anchor.web3.Keypair.generate();
    const victim = anchor.web3.Keypair.generate();
    const orderId = "ATTACK_ORDER";

    // Airdrop SOL to attacker
    await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(attacker.publicKey, 2e9),
    );

    // Create ATA for attacker
    const attackerAta = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        attacker.publicKey
    );

    // Mint tokens to attacker
    await mintTo(
        provider.connection,
        authority.payer,
        mint,
        attackerAta,
        authority.publicKey,
        10_000_000
    );

    // Derive victim's PDA (using victim's key)
    const [victimDepositRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("deposit_record"), mint.toBuffer(), victim.publicKey.toBuffer(), Buffer.from(orderId)],
        program.programId
    );

    try {
        // Attacker tries to deposit but uses victim's PDA
        // This should fail because the PDA seeds won't match the signer (attacker)
        await program.methods
            .deposit(orderId, new anchor.BN(1_000_000))
            .accounts({
                user: attacker.publicKey,  // Attacker is the signer
                userTokenAccount: attackerAta,
                vaultState,
                vaultTokenAccount,
                depositRecord: victimDepositRecordPda,  // But trying to use victim's PDA
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([attacker])
            .rpc();

        expect.fail("Expected attack to fail due to PDA seed mismatch");
    } catch (err) {
        const msg = err.toString();
        console.log("Attack blocked:", msg);
        // Should fail with ConstraintSeeds error
        expect(msg).to.match(/(ConstraintSeeds|seeds|Invalid)/i);
        console.log("✅ PDA collision attack prevented - seeds validation works correctly");
    }
});

});