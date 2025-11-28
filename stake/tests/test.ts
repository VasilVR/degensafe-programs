import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  createMint,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { expect } from 'chai';
import { StakeProgram } from '../target/types/stake_program';

async function warpSeconds(provider, seconds) {
  for (let i = 0; i < seconds; i += 2) {
    await provider.connection._rpcRequest('getLatestBlockhash', []);
  }
}

describe('🪙 Stake Program - Create Pool', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StakeProgram as Program<StakeProgram>;
  const admin = provider.wallet;
  let user: anchor.web3.Keypair;
  let userTokenAccount: any;
  let tokenMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;

  before(async () => {
    // Create a token mint for staking
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    tokenMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      tokenMintKeypair
    );

    // Create a token mint for rewards
    const rewardMintKeypair = anchor.web3.Keypair.generate();
    rewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      rewardMintKeypair
    );

    const tokenInfo = await getMint(provider.connection, tokenMint);
    const rewardInfo = await getMint(provider.connection, rewardMint);

    expect(tokenInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );
    expect(rewardInfo.mintAuthority?.toBase58()).to.equal(
      admin.publicKey.toBase58()
    );

    console.log('✅ Token mint created:', tokenMint.toBase58());
    console.log('✅ Reward mint created:', rewardMint.toBase58());
  });

  it('1. ✅ Creates pool using token mint and reward mint', async () => {
    const rewardPercentage = 1000; // example: 10%
    await program.methods
      .createPool(null, new anchor.BN(rewardPercentage))
      .accounts({
        tokenMint: tokenMint,
        rewardMint: rewardMint,
        admin: admin.publicKey,
      })
      .rpc();

    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);

    expect(poolAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolAccount.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolAccount.owner.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(poolAccount.totalStaked.toNumber()).to.equal(0);
    expect(poolAccount.rewardPercentage.toNumber()).to.equal(rewardPercentage);

    console.log('✅ Pool created and verified:', poolPda.toBase58());
  });

  it('2. 🏦 Creates reward_vault PDA during pool creation', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault'), rewardMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log('Pool reward vault:', poolAccount.rewardVault.toBase58());
    console.log('Derived reward_vault PDA:', rewardVaultPda.toBase58());

    expect(poolAccount.rewardVault.toBase58()).to.equal(
      rewardVaultPda.toBase58()
    );
  });

  it('3. ❌ Fails to create pool if it already exists', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createPool(null, new anchor.BN(1000))
        .accounts({
          tokenMint: tokenMint,
          rewardMint: rewardMint,
          admin: admin.publicKey,
        })
        .rpc();

      throw new Error('Pool creation did not fail as expected');
    } catch (err: any) {
      console.log('✅ Expected error caught:', err.message);
      console.log('   Existing pool PDA:', poolPda.toBase58());
    }
  });

  it('4. ℹ️ Gets pool info via instruction', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolData = await program.methods
      .getPoolInfo()
      .accounts({ pool: poolPda })
      .view(); // `.view()` returns the struct directly

    console.log('✅ Pool info fetched:', {
      pool: poolPda.toBase58(),
      tokenMint: poolData.tokenMint.toBase58(),
      rewardMint: poolData.rewardMint.toBase58(),
      owner: poolData.owner.toBase58(),
      totalStaked: poolData.totalStaked.toString(),
      rewardPercentage: poolData.rewardPercentage.toString(),
      bump: poolData.bump,
      isActive: poolData.isActive,
    });

    expect(poolData.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(poolData.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolData.owner.toBase58()).to.equal(admin.publicKey.toBase58());
  });

  it('5. ✅ Admin updates reward percentage', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const newPercentage = 2500; // 25%

    await program.methods
      .updateRewardPercentage(new anchor.BN(newPercentage))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);

    console.log(
      '✅ Reward percentage updated to:',
      poolAccount.rewardPercentage.toString()
    );

    expect(poolAccount.rewardPercentage.toNumber()).to.equal(newPercentage);
  });

  it('6. ❌ Fails to update reward percentage if not pool owner', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const nonOwner = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .updateRewardPercentage(new anchor.BN(7777))
        .accounts({
          pool: poolPda,
          admin: nonOwner.publicKey,
        })
        .signers([nonOwner])
        .rpc();

      throw new Error('Unexpected success by non-owner');
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log('❌ Expected Unauthorized error:', errMsg);

      expect(errMsg).to.include('Unauthorized');
    }
  });

  it('7. 📌 Pool info unchanged after failed percentage update attempt', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const info = await program.methods
      .getPoolInfo()
      .accounts({ pool: poolPda })
      .view();

    console.log('📌 After failed update attempt:', {
      rewardPercentage: info.rewardPercentage.toString(),
    });

    expect(info.rewardPercentage.toNumber()).to.equal(2500);
  });

  it('8. 💰 Admin deposits reward tokens into reward_vault', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const rewardVaultPda = poolAccount.rewardVault; //

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      rewardMint,
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 500_000_000; // 500 tokens (6 decimals)
    await mintTo(
      provider.connection,
      admin.payer,
      rewardMint,
      adminRewardAccount.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    // Fetch balance before deposit
    const beforeVault = await getAccount(provider.connection, rewardVaultPda);
    console.log('Vault balance BEFORE deposit:', Number(beforeVault.amount));

    // Call deposit_reward instruction
    await program.methods
      .depositReward(new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccount.address,
        rewardVault: rewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Fetch balance after deposit
    const afterVault = await getAccount(provider.connection, rewardVaultPda);
    console.log('Vault balance AFTER deposit:', Number(afterVault.amount));

    // Validate deposit
    expect(Number(afterVault.amount) - Number(beforeVault.amount)).to.equal(
      DEPOSIT_AMOUNT
    );

    console.log('✅ Reward deposited successfully!');
  });

  it('9. ℹ️ Verify pool info reflects correct reward vault and reward mint', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolInfo = await program.methods
      .getPoolInfo()
      .accounts({ pool: poolPda })
      .view();

    console.log('📌 Pool info after deposit:', {
      rewardMint: poolInfo.rewardMint.toBase58(),
      rewardVault: poolInfo.rewardVault.toBase58(),
      totalStaked: poolInfo.totalStaked.toString(),
      rewardPercentage: poolInfo.rewardPercentage.toString(),
    });

    // Assertions
    expect(poolInfo.rewardMint.toBase58()).to.equal(rewardMint.toBase58());
    expect(poolInfo.rewardVault.toBase58()).to.be.a('string'); // PDA should exist
  });

  it('10a. 🔄 Admin updates pool reward mint and vault', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    // Create a new reward mint
    const newRewardMintKeypair = anchor.web3.Keypair.generate();
    const newRewardMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6,
      newRewardMintKeypair
    );

    console.log('✅ New reward mint created:', newRewardMint.toBase58());

    // Derive the reward vault PDA for the new reward mint
    const [newRewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault'), newRewardMint.toBuffer()],
      program.programId
    );

    await program.methods
      .updateRewardMint()
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        newRewardMint: newRewardMint,
        rewardVault: newRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Fetch updated pool
    const updatedPool = await program.account.pool.fetch(poolPda);
    console.log(
      '✅ Updated pool reward mint:',
      updatedPool.rewardMint.toBase58()
    );
    console.log(
      '✅ Updated pool reward vault:',
      updatedPool.rewardVault.toBase58()
    );

    expect(updatedPool.rewardMint.toBase58()).to.equal(
      newRewardMint.toBase58()
    );
    expect(updatedPool.rewardVault.toBase58()).to.equal(
      newRewardVaultPda.toBase58()
    );

    // Optionally, check the reward vault account exists
    const vaultAccount = await getAccount(
      provider.connection,
      newRewardVaultPda
    );
    console.log('🏦 New reward vault balance:', Number(vaultAccount.amount));
  });

  it('11. 💸 Track original vs current pool reward vault balances (show addresses)', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const currentRewardVaultPda = poolAccount.rewardVault;
    const poolRewardMint = poolAccount.rewardMint;

    // Derive the original reward vault PDA from original rewardMint
    const [originalRewardVaultPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault'), rewardMint.toBuffer()],
        program.programId
      );

    // Mint some tokens to admin for current pool reward mint
    const adminRewardAccountPool = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolRewardMint,
      admin.publicKey
    );

    const DEPOSIT_AMOUNT = 500_000_000; // 500 tokens

    await mintTo(
      provider.connection,
      admin.payer,
      poolRewardMint,
      adminRewardAccountPool.address,
      admin.publicKey,
      DEPOSIT_AMOUNT
    );

    // Fetch vault balances BEFORE deposit
    const beforeOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const beforeCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      '🏦 Original reward vault address:',
      originalRewardVaultPda.toBase58()
    );
    console.log(
      '🏦 Original reward vault BEFORE:',
      Number(beforeOriginalVault.amount)
    );
    console.log(
      '🏦 Current pool reward vault address:',
      currentRewardVaultPda.toBase58()
    );
    console.log(
      '🏦 Current pool reward vault BEFORE:',
      Number(beforeCurrentVault.amount)
    );

    // Deposit to current pool reward vault
    await program.methods
      .depositReward(new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccountPool.address,
        rewardVault: currentRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterDepositOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const afterDepositCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      '🏦 Original reward vault AFTER deposit:',
      Number(afterDepositOriginalVault.amount)
    );
    console.log(
      '🏦 Current pool reward vault AFTER deposit:',
      Number(afterDepositCurrentVault.amount)
    );

    // Withdraw some tokens from current pool reward vault
    const WITHDRAW_AMOUNT = 100_000_000; // 100 tokens
    await program.methods
      .withdrawReward(new anchor.BN(WITHDRAW_AMOUNT))
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
        adminRewardAccount: adminRewardAccountPool.address,
        rewardVault: currentRewardVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const afterWithdrawOriginalVault = await getAccount(
      provider.connection,
      originalRewardVaultPda
    );
    const afterWithdrawCurrentVault = await getAccount(
      provider.connection,
      currentRewardVaultPda
    );

    console.log(
      '🏦 Original reward vault address:',
      originalRewardVaultPda.toBase58()
    );
    console.log(
      '🏦 Original reward vault AFTER withdraw:',
      Number(afterWithdrawOriginalVault.amount)
    );
    console.log(
      '🏦 Current pool reward vault address:',
      currentRewardVaultPda.toBase58()
    );
    console.log(
      '🏦 Current pool reward vault AFTER withdraw:',
      Number(afterWithdrawCurrentVault.amount)
    );

    // Assertions for current pool vault only
    expect(
      Number(afterDepositCurrentVault.amount) -
        Number(beforeCurrentVault.amount)
    ).to.equal(DEPOSIT_AMOUNT);
    expect(Number(afterWithdrawCurrentVault.amount) + WITHDRAW_AMOUNT).to.equal(
      Number(afterDepositCurrentVault.amount)
    );
  });

  it('11. ❌ Non-admin cannot withdraw from original or current reward vault', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    const poolAccount = await program.account.pool.fetch(poolPda);
    const currentRewardVaultPda = poolAccount.rewardVault;
    const poolRewardMint = poolAccount.rewardMint;

    // Derive original reward vault PDA
    const [originalRewardVaultPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault'), rewardMint.toBuffer()],
        program.programId
      );

    // Random non-admin wallet
    const nonAdmin = anchor.web3.Keypair.generate();

    // Fund non-admin with some SOL for tx fees
    const sig = await provider.connection.requestAirdrop(
      nonAdmin.publicKey,
      1e9
    );
    await provider.connection.confirmTransaction(sig);

    // Non-admin associated token accounts
    const nonAdminOriginalAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      nonAdmin,
      rewardMint, // original mint
      nonAdmin.publicKey
    );

    const nonAdminCurrentAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      nonAdmin,
      poolRewardMint, // current mint
      nonAdmin.publicKey
    );

    const WITHDRAW_AMOUNT = 100_000_000; // 100 tokens

    // Attempt withdrawal from original vault
    try {
      await program.methods
        .withdrawReward(new anchor.BN(WITHDRAW_AMOUNT))
        .accounts({
          pool: poolPda,
          admin: nonAdmin.publicKey,
          adminRewardAccount: nonAdminOriginalAccount.address,
          rewardVault: originalRewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([nonAdmin])
        .rpc();

      throw new Error(
        'Non-admin withdrawal from original vault succeeded unexpectedly'
      );
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log('✅ Expected error (original vault):', errMsg);
      expect(errMsg).to.include('A raw constraint was violated');
    }

    // Attempt withdrawal from current vault
    try {
      await program.methods
        .withdrawReward(new anchor.BN(WITHDRAW_AMOUNT))
        .accounts({
          pool: poolPda,
          admin: nonAdmin.publicKey,
          adminRewardAccount: nonAdminCurrentAccount.address,
          rewardVault: currentRewardVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([nonAdmin])
        .rpc();

      throw new Error(
        'Non-admin withdrawal from current vault succeeded unexpectedly'
      );
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log('✅ Expected Unauthorized error (current vault):', errMsg);
      expect(errMsg).to.include('Unauthorized');
    }
  });

  it('12. ❌ Fails to deposit reward when pool is disabled', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    // First, disable the pool
    await program.methods
      .setStakingActive(false)
      .accounts({
        pool: poolPda,
        admin: admin.publicKey,
      })
      .rpc();

    const poolAccount = await program.account.pool.fetch(poolPda);
    expect(poolAccount.isActive).to.equal(false);
    console.log('🔒 Pool disabled successfully');

    // Prepare deposit amount
    const DEPOSIT_AMOUNT = 100_000_000; // 100 tokens

    const adminRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      poolAccount.rewardMint,
      admin.publicKey
    );

    // Attempt deposit while pool is disabled
    try {
      await program.methods
        .depositReward(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          pool: poolPda,
          admin: admin.publicKey,
          adminRewardAccount: adminRewardAccount.address,
          rewardVault: poolAccount.rewardVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      throw new Error('Deposit succeeded while pool is disabled');
    } catch (err: any) {
      const errMsg = err.error?.errorMessage || err.message;
      console.log('✅ Expected error caught:', errMsg);
      expect(errMsg).to.include('Staking is currently disabled');
    }
  });

  it('13. 🧑‍💼 User deposits stake twice and check balances', async () => {
    const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), tokenMint.toBuffer()],
      program.programId
    );

    // Ensure pool is active
    await program.methods
      .setStakingActive(true)
      .accounts({ pool: poolPda, admin: admin.publicKey })
      .rpc();

    user = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000);

    // Create user's token account and mint tokens
    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenMint,
      user.publicKey
    );

    // First deposit
    const FIRST_DEPOSIT = new anchor.BN(500_000_000);
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      FIRST_DEPOSIT.toNumber()
    );

    const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from('user_stake'),
        poolPda.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), tokenMint.toBuffer()],
      program.programId
    );

    await program.methods
      .depositStake(FIRST_DEPOSIT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    const userStakeAccount1 = await program.account.userStake.fetch(
      userStakePda
    );
    console.log('📊 User stake info after 1st deposit:', {
      owner: userStakeAccount1.owner.toBase58(),
      pool: userStakeAccount1.pool.toBase58(),
      amount: userStakeAccount1.amount.toString(),
      totalEarned: userStakeAccount1.totalEarned.toString(),
      lastStakedTime: new Date(
        (userStakeAccount1.lastStakedTime as any) * 1000
      ).toISOString(),
    });

    // Second deposit
    const SECOND_DEPOSIT = new anchor.BN(300_000_000);
    await mintTo(
      provider.connection,
      admin.payer,
      tokenMint,
      userTokenAccount.address,
      admin.publicKey,
      SECOND_DEPOSIT.toNumber()
    );

    await program.methods
      .depositStake(SECOND_DEPOSIT)
      .accounts({
        pool: poolPda,
        user: user.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount.address,
        poolVault: poolVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    const userStakeAccount = await program.account.userStake.fetch(
      userStakePda
    );
    console.log('📊 User stake info after two deposits:', {
      owner: userStakeAccount.owner.toBase58(),
      pool: userStakeAccount.pool.toBase58(),
      amount: userStakeAccount.amount.toString(),
      totalEarned: userStakeAccount.totalEarned.toString(),
      lastStakedTime: new Date(
        (userStakeAccount.lastStakedTime as any) * 1000
      ).toISOString(),
    });

    expect(userStakeAccount.amount.toString()).to.equal(
      FIRST_DEPOSIT.add(SECOND_DEPOSIT).toString()
    );
  });
async function warpSeconds(provider, seconds) {
  for (let i = 0; i < seconds; i += 2) {
    await provider.connection._rpcRequest('getLatestBlockhash', []);
  }
}

it('User can deposit then withdraw part of their staked amount (partial withdraw) with time warp and pending rewards check', async () => {
  console.log('\n================= 🧪 PARTIAL WITHDRAW TEST =================\n');

  // -------------------------
  // PDAs
  // -------------------------
  const [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );
  const [userStakePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), poolPda.toBuffer(), user.publicKey.toBuffer()],
    program.programId
  );
  const [poolVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), tokenMint.toBuffer()],
    program.programId
  );

  // -------------------------
  // 1) Mint initial tokens
  // -------------------------
  const MINT_AMOUNT = 1_000_000_000;
  await mintTo(provider.connection, admin.payer, tokenMint, userTokenAccount.address, admin.publicKey, MINT_AMOUNT);

  const userBeforeMint = await getAccount(provider.connection, userTokenAccount.address);
  console.log('User token balance BEFORE stake:', Number(userBeforeMint.amount));

  // -------------------------
  // 2) Deposit / Stake
  // -------------------------
  const DEPOSIT_AMOUNT = new anchor.BN(800_000_000);
  console.log('\n🔹 Depositing:', DEPOSIT_AMOUNT.toString());

  await program.methods
    .depositStake(DEPOSIT_AMOUNT)
    .accounts({
      pool: poolPda,
      user: user.publicKey,
      userStake: userStakePda,
      userTokenAccount: userTokenAccount.address,
      poolVault: poolVaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();

  const userAfterDeposit = await getAccount(provider.connection, userTokenAccount.address);
  const vaultAfterDeposit = await getAccount(provider.connection, poolVaultPda);
  const userStakeAfterDeposit = await program.account.userStake.fetch(userStakePda);
  const poolAfterDeposit = await program.account.pool.fetch(poolPda);

  console.log('\n======== STAKE INFO AFTER DEPOSIT ========');
  console.log('User balance AFTER deposit:', Number(userAfterDeposit.amount));
  console.log('Vault balance AFTER deposit:', Number(vaultAfterDeposit.amount));
  console.log('UserStake.amount:', userStakeAfterDeposit.amount.toString());
  console.log('UserStake.unclaimed:', userStakeAfterDeposit.unclaimed.toString());
  console.log('Pool.total_staked:', poolAfterDeposit.totalStaked.toString());

  const userStakeInfo1 = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();

  console.log('Pending reward AFTER deposit:', Number(userStakeInfo1.pendingReward));

  // -------------------------
  // 3) Warp 1 day
  // -------------------------
  console.log('\n⏳ Advancing blockchain by 1 day...');
  await warpSeconds(provider, 86400);

  // -------------------------
  // 4) Withdraw 50%
  // -------------------------
  const WITHDRAW_AMOUNT = new anchor.BN(400_000_000);
  console.log('\n🔹 Withdrawing 50% of stake:', WITHDRAW_AMOUNT.toString());

  const poolBeforeWithdraw = await program.account.pool.fetch(poolPda);
  const userStakeBeforeWithdraw = await program.account.userStake.fetch(userStakePda);
  const userBeforeWithdraw = await getAccount(provider.connection, userTokenAccount.address);
  const vaultBeforeWithdraw = await getAccount(provider.connection, poolVaultPda);
  const userRewardAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    user,
    poolBeforeWithdraw.rewardMint,
    user.publicKey
  );
  const userRewardBefore = await getAccount(provider.connection, userRewardAccount.address);

  console.log('\n======== STAKE INFO BEFORE WITHDRAW ========');
  console.log('UserStake.amount:', userStakeBeforeWithdraw.amount.toString());
  console.log('UserStake.unclaimed:', userStakeBeforeWithdraw.unclaimed.toString());
  console.log('Pool.total_staked:', poolBeforeWithdraw.totalStaked.toString());
  console.log('User balance BEFORE withdraw:', Number(userBeforeWithdraw.amount));
  console.log('Vault balance BEFORE withdraw:', Number(vaultBeforeWithdraw.amount));
  console.log('User reward balance BEFORE withdraw:', Number(userRewardBefore.amount));

  const userStakeInfoBeforeWithdraw = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();
  console.log('Pending reward BEFORE withdraw:', Number(userStakeInfoBeforeWithdraw.pendingReward));

  await program.methods
    .withdrawStake(WITHDRAW_AMOUNT)
    .accounts({
      pool: poolPda,
      user: user.publicKey,
      userStake: userStakePda,
      userTokenAccount: userTokenAccount.address,
      userRewardAccount: userRewardAccount.address,
      poolVault: poolVaultPda,
      rewardVault: poolBeforeWithdraw.rewardVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  const userAfterWithdraw = await getAccount(provider.connection, userTokenAccount.address);
  const vaultAfterWithdraw = await getAccount(provider.connection, poolVaultPda);
  const userStakeAfterWithdraw = await program.account.userStake.fetch(userStakePda);
  const poolAfterWithdraw = await program.account.pool.fetch(poolPda);
  const userRewardAfter = await getAccount(provider.connection, userRewardAccount.address);

  console.log('\n======== STAKE INFO AFTER WITHDRAW ========');
  console.log('User balance AFTER withdraw:', Number(userAfterWithdraw.amount));
  console.log('Vault balance AFTER withdraw:', Number(vaultAfterWithdraw.amount));
  console.log('UserStake.amount:', userStakeAfterWithdraw.amount.toString());
  console.log('UserStake.unclaimed:', userStakeAfterWithdraw.unclaimed.toString());
  console.log('Pool.total_staked:', poolAfterWithdraw.totalStaked.toString());
  console.log('User reward balance AFTER withdraw:', Number(userRewardAfter.amount));

  const userStakeInfoAfterWithdraw = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();
  console.log('Pending reward AFTER withdraw:', Number(userStakeInfoAfterWithdraw.pendingReward));

  const rewardReceived = Number(userRewardAfter.amount) - Number(userRewardBefore.amount);
  console.log('Reward tokens received from withdraw:', rewardReceived);

  // -------------------------
  // 5) Warp 2 more days
  // -------------------------
  console.log('\n⏳ Advancing blockchain by 2 days...');
  await warpSeconds(provider, 2 * 86400);

  // -------------------------
  // 6) Withdraw remaining stake
  // -------------------------
  const remainingStake = new anchor.BN(userStakeAfterWithdraw.amount.toString());
  console.log('\n🔹 Withdrawing remaining stake:', remainingStake.toString());

  const userRewardBefore2 = await getAccount(provider.connection, userRewardAccount.address);
  const userBeforeWithdraw2 = await getAccount(provider.connection, userTokenAccount.address);
  const vaultBeforeWithdraw2 = await getAccount(provider.connection, poolVaultPda);
  const userStakeBeforeWithdraw2 = await program.account.userStake.fetch(userStakePda);
  const poolBeforeWithdraw2 = await program.account.pool.fetch(poolPda);

  const userStakeInfoBeforeFinalWithdraw = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();
  console.log('Pending reward BEFORE final withdraw:', Number(userStakeInfoBeforeFinalWithdraw.pendingReward));

  await program.methods
    .withdrawStake(remainingStake)
    .accounts({
      pool: poolPda,
      user: user.publicKey,
      userStake: userStakePda,
      userTokenAccount: userTokenAccount.address,
      userRewardAccount: userRewardAccount.address,
      poolVault: poolVaultPda,
      rewardVault: poolBeforeWithdraw2.rewardVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  const userAfterWithdraw2 = await getAccount(provider.connection, userTokenAccount.address);
  const vaultAfterWithdraw2 = await getAccount(provider.connection, poolVaultPda);
  const userStakeAfterWithdraw2 = await program.account.userStake.fetch(userStakePda);
  const poolAfterWithdraw2 = await program.account.pool.fetch(poolPda);
  const userRewardAfter2 = await getAccount(provider.connection, userRewardAccount.address);

  const userStakeInfoAfterFinalWithdraw = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();

  console.log('\n======== STAKE INFO AFTER FINAL WITHDRAW ========');
  console.log('User balance AFTER withdraw:', Number(userAfterWithdraw2.amount));
  console.log('Vault balance AFTER withdraw:', Number(vaultAfterWithdraw2.amount));
  console.log('UserStake.amount:', userStakeAfterWithdraw2.amount.toString());
  console.log('UserStake.unclaimed:', userStakeAfterWithdraw2.unclaimed.toString());
  console.log('Pool.total_staked:', poolAfterWithdraw2.totalStaked.toString());
  console.log('User reward balance AFTER withdraw:', Number(userRewardAfter2.amount));
  console.log('Pending reward AFTER final withdraw:', Number(userStakeInfoAfterFinalWithdraw.pendingReward));

  // -------------------------
  // 7) Warp 2 hours after 0 stake
  // -------------------------
  console.log('\n⏳ Advancing blockchain by 2 hours to check rewards with 0 stake...');
  await warpSeconds(provider, 2 * 3600);

  const userStakeInfoAfter2h = await program.methods
    .getUserStakeWithReward()
    .accounts({
      pool: poolPda,
      userStake: userStakePda,
    })
    .view();

  console.log('Pending reward 2 hours after 0 stake:', Number(userStakeInfoAfter2h.pendingReward));
});

});
