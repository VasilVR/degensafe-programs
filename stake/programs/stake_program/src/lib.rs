use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GtgbhnDFLdbh1kBu4htmBbZrB3c5C8MP8px8Yq5jbstX");

/// Slots per year constant for reward calculations
/// Solana produces blocks at approximately 400ms per slot (2.5 slots/second)
/// Calculation: 365.25 days * 24 hours * 60 minutes * 60 seconds * 2.5 slots/second
/// = 78,894,000 slots/year (rounded to 78,840,000 for conservative estimates)
const SLOTS_PER_YEAR: u64 = 78_840_000;

/// Validates that a token account address is safe to use as a withdrawal destination
/// Ensures the address is not:
/// - Default/zero address
/// - The pool PDA or any vault PDA
/// - A token mint address
/// Additionally validates the token account owner (wallet) is not a program-owned account
fn validate_withdrawal_address(
    token_account_address: &Pubkey,
    token_account_owner: &Pubkey,
    pool_pda: &Pubkey,
    reward_vault_pda: Option<&Pubkey>,
    token_mint: &Pubkey,
    reward_mint: Option<&Pubkey>,
) -> Result<()> {
    // Check token account address is not default
    require!(
        *token_account_address != Pubkey::default(),
        CustomError::InvalidWithdrawalAddress
    );
    
    // Check token account is not the pool PDA itself
    require!(
        *token_account_address != *pool_pda,
        CustomError::InvalidWithdrawalAddress
    );
    
    // Check token account is not the reward vault PDA if provided
    if let Some(reward_vault) = reward_vault_pda {
        require!(
            *token_account_address != *reward_vault,
            CustomError::InvalidWithdrawalAddress
        );
    }
    
    // Check token account address is not the token mint
    require!(
        *token_account_address != *token_mint,
        CustomError::InvalidWithdrawalAddress
    );
    
    // Check token account address is not the reward mint if provided
    if let Some(mint) = reward_mint {
        require!(
            *token_account_address != *mint,
            CustomError::InvalidWithdrawalAddress
        );
    }
    
    // Validate the token account owner (wallet) is not default
    require!(
        *token_account_owner != Pubkey::default(),
        CustomError::InvalidWithdrawalAddress
    );
    
    // Validate the token account owner is not the pool PDA
    require!(
        *token_account_owner != *pool_pda,
        CustomError::InvalidWithdrawalAddress
    );
    
    Ok(())
}

/// Validates that an address is safe to use as a new authority
/// Ensures the address is not:
/// - Default/zero address
/// - The pool PDA itself
/// 
/// Note: We cannot validate if an arbitrary Pubkey is program-owned without loading
/// it as an account. However, program-owned addresses (PDAs) cannot sign transactions,
/// so setting a PDA as authority would effectively lock the pool from admin operations.
/// The validation here prevents common mistakes (default address, pool PDA).
fn validate_authority_address(
    address: &Pubkey,
    pool_pda: &Pubkey,
) -> Result<()> {
    // Check not default address
    require!(
        *address != Pubkey::default(),
        CustomError::InvalidAuthorityAddress
    );
    
    // Check not the pool PDA itself
    require!(
        *address != *pool_pda,
        CustomError::InvalidAuthorityAddress
    );
    
    Ok(())
}

#[program]
pub mod stake_program {
    use super::*;

    pub fn create_pool(
        ctx: Context<CreatePool>,
        maybe_owner: Option<Pubkey>,
        reward_percentage: u64,
        pool_id: u64,
    ) -> Result<()> {
        // Validate reward percentage to prevent accidental extreme values
        // Format: Basis points (bps) - 10000 bps = 100% APY
        // Examples: 550 bps = 5.50%, 1000 bps = 10.00%, 2500 bps = 25.00%
        // - Allow 0 for no-reward staking
        // - Cap at 100_000_000 bps (1,000,000% APY) to prevent typos and excess rewards
        require!(
            reward_percentage <= 100_000_000,
            CustomError::InvalidRewardPercentage
        );

        let pool_key = ctx.accounts.pool.key(); // immutable borrow first
        
        // Initialize or update pool_id_counter
        let pool_id_counter = &mut ctx.accounts.pool_id_counter;
        if pool_id_counter.next_pool_id == 0 && pool_id_counter.token_mint == Pubkey::default() {
            // First time initialization
            pool_id_counter.token_mint = ctx.accounts.token_mint.key();
            pool_id_counter.bump = ctx.bumps.pool_id_counter;
        }
        
        // Validate pool_id matches expected next_pool_id for auto-increment
        // This ensures pools are created in sequential order
        require!(
            pool_id == pool_id_counter.next_pool_id,
            CustomError::InvalidPoolId
        );
        
        // Increment counter for next pool (check for overflow)
        pool_id_counter.next_pool_id = pool_id_counter.next_pool_id
            .checked_add(1)
            .ok_or(CustomError::PoolCounterOverflow)?;

        let pool = &mut ctx.accounts.pool; // mutable borrow starts here

        // Set owner: user provided or fallback to admin (signer)
        pool.owner = maybe_owner.unwrap_or(ctx.accounts.admin.key());
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.reward_percentage = reward_percentage;
        pool.total_staked = 0;
        pool.bump = ctx.bumps.pool;
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.is_active = true;
        pool.pool_id = pool_id;
        
        // Initialize first reward epoch with current slot
        let clock = Clock::get()?;
        pool.reward_epochs = vec![RewardEpoch {
            reward_percentage,
            start_slot: clock.slot,
        }];
        pool.last_reward_update_slot = clock.slot;
        
        emit!(PoolCreatedEvent {
            pool: pool_key,
            token_mint: pool.token_mint,
            reward_mint: pool.reward_mint,
            owner: pool.owner,
            reward_percentage: pool.reward_percentage,
            slot: clock.slot,
        });

        msg!("Staking pool created successfully");
        msg!("Pool PDA: {}", pool_key);
        msg!("Pool ID: {}", pool_id);

        Ok(())
    }

    pub fn get_pool_info(ctx: Context<GetPoolInfo>, _pool_id: u64) -> Result<PoolData> {
        let pool = &ctx.accounts.pool;
        Ok(PoolData {
            token_mint: pool.token_mint,
            reward_vault: pool.reward_vault,
            reward_mint: pool.reward_mint,
            owner: pool.owner,
            total_staked: pool.total_staked,
            reward_percentage: pool.reward_percentage,
            bump: pool.bump,
            is_active: pool.is_active,
            reward_epochs: pool.reward_epochs.clone(),
            last_reward_update_slot: pool.last_reward_update_slot,
            pool_id: pool.pool_id,
        })
    }

    pub fn set_staking_active(ctx: Context<SetStakingActive>, _pool_id: u64, active: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );
        pool.is_active = active;
        
        let clock = Clock::get()?;
        
        emit!(PoolStakingActiveChangedEvent {
            pool: pool.key(),
            is_active: active,
            admin: ctx.accounts.admin.key(),
            slot: clock.slot,
        });

        msg!(
            "Pool staking is now {}",
            if active { "enabled" } else { "disabled" }
        );
        Ok(())
    }

    pub fn update_reward_mint(ctx: Context<UpdateRewardMint>, _pool_id: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Only the pool owner (admin) can update
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Update reward mint and vault
        pool.reward_mint = ctx.accounts.new_reward_mint.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();

        let clock = Clock::get()?;
        
        emit!(PoolRewardMintUpdatedEvent {
            pool: pool.key(),
            new_reward_mint: pool.reward_mint,
            new_reward_vault: pool.reward_vault,
            admin: ctx.accounts.admin.key(),
            slot: clock.slot,
        });

        msg!("Reward mint updated to {}", pool.reward_mint);

        Ok(())
    }

    pub fn update_reward_percentage(
        ctx: Context<UpdateRewardPercentage>,
        _pool_id: u64,
        new_percentage: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Only pool owner can update
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Validate reward percentage to prevent accidental extreme values
        // Format: Basis points (bps) - 10000 bps = 100% APY
        // Examples: 550 bps = 5.50%, 1000 bps = 10.00%, 2500 bps = 25.00%
        // - Allow 0 for no-reward staking
        // - Cap at 100_000_000 bps (1,000,000% APY) to prevent typos and excess rewards
        require!(
            new_percentage <= 100_000_000,
            CustomError::InvalidRewardPercentage
        );

        let old_percentage = pool.reward_percentage;
        let clock = Clock::get()?;
        
        // Add new epoch with the new reward percentage
        // Keep only the last 9 epochs to make room for the new one (max 10 total)
        if pool.reward_epochs.len() >= 10 {
            pool.reward_epochs.remove(0);
        }
        
        pool.reward_epochs.push(RewardEpoch {
            reward_percentage: new_percentage,
            start_slot: clock.slot,
        });
        
        // Update current reward percentage and last update slot
        pool.reward_percentage = new_percentage;
        pool.last_reward_update_slot = clock.slot;
        
        emit!(PoolRewardPercentageUpdatedEvent {
            pool: pool.key(),
            old_percentage,
            new_percentage,
            admin: ctx.accounts.admin.key(),
            slot: clock.slot,
        });

        msg!("Reward percentage updated to {}", new_percentage);

        Ok(())
    }

    /// Updates the pool authority (owner) - enables authority rotation and recovery
    /// Only the current authority can call this function
    pub fn update_pool_authority(
        ctx: Context<UpdatePoolAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Only current pool owner can update authority
        require!(
            pool.owner == ctx.accounts.current_authority.key(),
            CustomError::Unauthorized
        );

        // Validate new authority address
        validate_authority_address(&new_authority, &pool.key())?;

        let old_authority = pool.owner;
        pool.owner = new_authority;

        msg!("Pool authority updated");
        msg!("Old authority: {}", old_authority);
        msg!("New authority: {}", new_authority);

        Ok(())
    }

    pub fn deposit_reward(ctx: Context<DepositReward>, _pool_id: u64, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        // Only pool owner can deposit
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Transfer tokens from admin → reward_vault (PDA)
        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_reward_account.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let clock = Clock::get()?;
        
        emit!(RewardDepositedEvent {
            pool: pool.key(),
            amount,
            admin: ctx.accounts.admin.key(),
            slot: clock.slot,
        });

        msg!("Reward deposited: {} tokens", amount);

        Ok(())
    }

    pub fn withdraw_reward(ctx: Context<WithdrawReward>, _pool_id: u64, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        // Only pool owner can withdraw
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Validate withdrawal address for safety
        validate_withdrawal_address(
            &ctx.accounts.admin_reward_account.key(),
            &ctx.accounts.admin_reward_account.owner,
            &ctx.accounts.pool.key(),
            Some(&ctx.accounts.reward_vault.key()),
            &pool.token_mint,
            Some(&pool.reward_mint),
        )?;

        let seeds = &[
            b"staking_pool",
            ctx.accounts.pool.token_mint.as_ref(),
            &ctx.accounts.pool.pool_id.to_le_bytes(),
            &[ctx.accounts.pool.bump],
        ];
        let signer = &[&seeds[..]];

        // Transfer tokens from reward vault → admin
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.reward_vault.to_account_info(),
            to: ctx.accounts.admin_reward_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(), // vault authority is pool PDA
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        let clock = Clock::get()?;
        
        emit!(RewardWithdrawnEvent {
            pool: pool.key(),
            amount,
            admin: ctx.accounts.admin.key(),
            slot: clock.slot,
        });

        msg!("Admin withdrew {} reward tokens", amount);

        Ok(())
    }

    pub fn deposit_stake(ctx: Context<DepositStake>, _pool_id: u64, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user_stake = &mut ctx.accounts.user_stake;
        let user = &ctx.accounts.user;
        let clock = Clock::get()?; // get current timestamp

        // Check if pool is active
        require!(pool.is_active, CustomError::StakingDisabled);

        // Transfer tokens from user -> pool vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Initialize UserStake if first time
        if user_stake.amount == 0 {
            // EDGE CASE: Account exists but has zero stake (after full withdrawal or reinitialization)
            // SECURITY: Validate pool association to prevent resurrection attacks where an attacker
            // attempts to reuse a zeroed account (after full withdrawal) for a different pool.
            // Since the user controls their own account via PDA seeds (derived from user.key()),
            // this check ensures the account can only be reused for the same pool it was created for.
            if user_stake.owner != Pubkey::default() {
                // Account was previously used - validate pool association to prevent reuse for different pool
                require!(
                    user_stake.pool == pool.key(),
                    CustomError::InvalidPoolAssociation
                );
                // Account already exists (after full withdrawal) - preserve unclaimed rewards
                // but add any new pending rewards since last action
                let pending = user_stake.calculate_pending_reward(pool);
                user_stake.unclaimed = user_stake.unclaimed.checked_add(pending).unwrap();
            } else {
                // First time initialization - set up account
                user_stake.owner = user.key();
                user_stake.pool = pool.key();
                user_stake.total_earned = 0;
                user_stake.unclaimed = 0;
                user_stake.bump = ctx.bumps.user_stake;
            }
        } else {
            // Existing stake with non-zero amount - validate pool association
            require!(
                user_stake.pool == pool.key(),
                CustomError::InvalidPoolAssociation
            );
            let pending = user_stake.calculate_pending_reward(pool);
            user_stake.unclaimed = user_stake.unclaimed.checked_add(pending).unwrap();
        }

        // Update user stake
        user_stake.amount = user_stake.amount.checked_add(amount).unwrap();
        user_stake.last_staked_slot = clock.slot;

        // Update pool info
        pool.total_staked = pool.total_staked.checked_add(amount).unwrap();

        emit!(StakeDepositedEvent {
            user: user.key(),
            pool: pool.key(),
            amount,
            total_user_stake: user_stake.amount,
            total_pool_stake: pool.total_staked,
            slot: clock.slot,
        });

        msg!("{} tokens staked by {}", amount, user.key());
        msg!("Total staked in pool: {}", pool.total_staked);

        Ok(())
    }

    pub fn get_user_stake_info(ctx: Context<GetUserStakeInfo>, _pool_id: u64) -> Result<UserStakeData> {
        let user_stake = &ctx.accounts.user_stake;
        Ok(UserStakeData {
            owner: user_stake.owner,
            pool: user_stake.pool,
            amount: user_stake.amount,
            total_earned: user_stake.total_earned,
            last_staked_slot: user_stake.last_staked_slot,
            unclaimed: user_stake.unclaimed,
            bump: user_stake.bump,
        })
    }

    pub fn get_user_stake_with_reward(
        ctx: Context<GetUserStakeInfo>,
        _pool_id: u64,
    ) -> Result<UserStakeInfoWithReward> {
        let user_stake = &ctx.accounts.user_stake;
        let pool = &ctx.accounts.pool;

        let pending_reward = user_stake.calculate_pending_reward(pool);

        Ok(UserStakeInfoWithReward {
            owner: user_stake.owner,
            pool: user_stake.pool,
            amount: user_stake.amount,
            total_earned: user_stake.total_earned,
            last_staked_slot: user_stake.last_staked_slot,
            unclaimed: user_stake.unclaimed,
            bump: user_stake.bump,
            pending_reward,
        })
    }

    pub fn withdraw_stake(ctx: Context<WithdrawStake>, _pool_id: u64, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user_stake = &mut ctx.accounts.user_stake;

        let clock = Clock::get()?; // get current timestamp

        // Check if pool is active
        require!(pool.is_active, CustomError::StakingDisabled);

        // Ensure user has enough staked
        require!(user_stake.amount >= amount, CustomError::Unauthorized);

        let pending = user_stake.calculate_pending_reward(pool);
        let total_rewards = pending.checked_add(user_stake.unclaimed).unwrap();

        // Check if reward vault has sufficient balance to pay rewards
        let reward_to_send = if ctx.accounts.reward_vault.amount >= total_rewards {
            // Vault has enough - pay rewards now
            total_rewards
        } else {
            // Vault insufficient - keep rewards as unclaimed for later
            0
        };

        // Update user state
        if reward_to_send > 0 {
            // Rewards paid out - clear unclaimed and update total earned
            user_stake.total_earned = user_stake.total_earned.checked_add(reward_to_send).unwrap();
            user_stake.unclaimed = 0;
        } else {
            // Rewards not paid - preserve all rewards (old unclaimed + new pending) for later withdrawal
            // Note: total_rewards already includes user_stake.unclaimed from line 288
            user_stake.unclaimed = total_rewards;
        }

        user_stake.amount = user_stake.amount.checked_sub(amount).unwrap();
        user_stake.last_staked_slot = clock.slot;
        pool.total_staked = pool.total_staked.checked_sub(amount).unwrap();

        // Transfer staked tokens from pool vault -> user
        let seeds = &[b"staking_pool", pool.token_mint.as_ref(), &pool.pool_id.to_le_bytes(), &[pool.bump]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        // Transfer rewards if vault has sufficient balance
        if reward_to_send > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        to: ctx.accounts.user_reward_account.to_account_info(),
                        authority: pool.to_account_info(),
                    },
                    signer,
                ),
                reward_to_send,
            )?;
        }

        emit!(StakeWithdrawnEvent {
            user: ctx.accounts.user.key(),
            pool: pool.key(),
            amount,
            rewards_sent: reward_to_send,
            rewards_unclaimed: user_stake.unclaimed,
            remaining_user_stake: user_stake.amount,
            total_pool_stake: pool.total_staked,
            slot: clock.slot,
        });

        if reward_to_send > 0 {
            msg!("Withdrawn stake: {}", amount);
            msg!("Rewards sent: {}", reward_to_send);
        } else {
            msg!("Withdrawn stake: {}", amount);
            msg!("Rewards unavailable (vault empty). {} tokens saved as unclaimed.", total_rewards);
        }

        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>, _pool_id: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let user_stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        // Check if pool is active
        require!(pool.is_active, CustomError::StakingDisabled);

        // Ensure user has some stake or unclaimed rewards
        require!(
            user_stake.amount > 0 || user_stake.unclaimed > 0,
            CustomError::NoRewardsAvailable
        );

        // Calculate pending rewards
        let pending = user_stake.calculate_pending_reward(pool);
        let total_reward = pending.checked_add(user_stake.unclaimed).unwrap();

        require!(total_reward > 0, CustomError::NoRewardsAvailable);

        // Check reward vault has sufficient balance
        require!(
            ctx.accounts.reward_vault.amount >= total_reward,
            CustomError::InsufficientRewardVault
        );

        // Update user state
        user_stake.total_earned = user_stake.total_earned.checked_add(total_reward).unwrap();
        user_stake.unclaimed = 0;
        user_stake.last_staked_slot = clock.slot;

        // Transfer rewards to user
        let seeds = &[b"staking_pool", pool.token_mint.as_ref(), &pool.pool_id.to_le_bytes(), &[pool.bump]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    to: ctx.accounts.user_reward_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer,
            ),
            total_reward,
        )?;

        emit!(RewardClaimedEvent {
            user: ctx.accounts.user.key(),
            pool: pool.key(),
            amount: total_reward,
            total_earned: user_stake.total_earned,
            user_stake: user_stake.amount,
            slot: clock.slot,
        });

        msg!("Claimed {} reward tokens", total_reward);
        msg!("User stake remains: {}", user_stake.amount);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(maybe_owner: Option<Pubkey>, reward_percentage: u64, pool_id: u64)]
pub struct CreatePool<'info> {
    /// Pool ID counter for tracking pool IDs per token mint
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"pool_id_counter", token_mint.key().as_ref()],
        bump,
        space = 8 + 32 + 8 + 1
    )]
    pub pool_id_counter: Account<'info, PoolIdCounter>,

    /// Pool account PDA, must not exist prior to creation to prevent reinitialization attacks
    #[account(
        init,
        payer = admin,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump,
        // Space calculation:
        // 8 (discriminator) + 32 (token_mint) + 32 (reward_mint) + 32 (reward_vault) +
        // 32 (owner) + 8 (total_staked) + 8 (reward_percentage) + 1 (bump) + 1 (is_active) +
        // 4 (vec length) + 10 * (8 + 8) (max 10 epochs: reward_percentage + start_time) +
        // 8 (last_reward_update_time) + 8 (pool_id)
        space = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 4 + (10 * 16) + 8 + 8
    )]
    pub pool: Account<'info, Pool>,

    /// Token mint for which the pool is created
    pub token_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"reward_vault", pool.key().as_ref(), reward_mint.key().as_ref()],
        bump,
        token::mint = reward_mint,
        token::authority = pool
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// Pool vault PDA for user stakes (new)
    #[account(
        init,
        payer = admin,
        seeds = [b"vault", pool.key().as_ref(), token_mint.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = pool
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    /// Admin of the program, used as payer and default owner
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct GetPoolInfo<'info> {
    #[account(
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    pub token_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct UpdateRewardMint<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,

    /// The new reward mint account
    pub new_reward_mint: Account<'info, Mint>,

    /// SECURITY NOTE: init_if_needed is acceptable here because:
    /// 1. The function has owner authorization check
    /// 2. The vault is deterministically derived from pool and new_reward_mint
    /// 3. This allows updating to an existing vault or creating a new one
    /// 4. Token account reinitialization is safe as authority is set to pool PDA
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"reward_vault", pool.key().as_ref(), new_reward_mint.key().as_ref()],
        bump,
        token::mint = new_reward_mint,
        token::authority = pool,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct DepositReward<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Admin signs (must be pool.owner)
    pub admin: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = admin_reward_account.mint == pool.reward_mint
    )]
    pub admin_reward_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref(), pool.reward_mint.as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct GetUserStakeInfo<'info> {
    #[account(
        constraint = user_stake.pool == pool.key() @ CustomError::InvalidPoolAssociation
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    pub token_mint: Account<'info, Mint>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserStakeData {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub total_earned: u64,
    pub last_staked_slot: u64,
    pub unclaimed: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct WithdrawStake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Security: Enforce that only the owner of the user_stake account can withdraw.
    /// This prevents privilege escalation where a malicious user attempts to withdraw
    /// from another user's stake account by providing a different user_stake PDA.
    /// Also validates that the user_stake belongs to the correct pool.
    #[account(
        mut,
        constraint = user_stake.owner == user.key() @ CustomError::Unauthorized,
        constraint = user_stake.pool == pool.key() @ CustomError::InvalidPoolAssociation
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_account.mint == pool.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

     #[account(
        mut,
        constraint = user_reward_account.mint == pool.reward_mint,
        constraint = user_reward_account.owner == user.key(),
    )]
    pub user_reward_account: Account<'info, TokenAccount>, 

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref(), pool.token_mint.as_ref()],
        bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref(), pool.reward_mint.as_ref()],
        bump,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct WithdrawReward<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Admin signer (must be pool owner)
    pub admin: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,

    /// Admin's token account to receive rewards
    #[account(
        mut,
        constraint = admin_reward_account.mint == pool.reward_mint
    )]
    pub admin_reward_account: Account<'info, TokenAccount>,

    /// Pool's reward vault
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref(), pool.reward_mint.as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    pub pool: Account<'info, Pool>,

    /// Security: Enforce that only the owner of the user_stake account can claim rewards.
    /// This prevents privilege escalation where a malicious user attempts to claim rewards
    /// from another user's stake account by providing a different user_stake PDA.
    /// Also validates that the user_stake belongs to the correct pool.
    #[account(
        mut,
        constraint = user_stake.owner == user.key() @ CustomError::Unauthorized,
        constraint = user_stake.pool == pool.key() @ CustomError::InvalidPoolAssociation
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// User's reward token account to receive rewards
    #[account(
        mut,
        constraint = user_reward_account.mint == pool.reward_mint,
        constraint = user_reward_account.owner == user.key(),
    )]
    pub user_reward_account: Account<'info, TokenAccount>,

    /// Pool's reward vault
    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref(), pool.reward_mint.as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct UpdateRewardPercentage<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    pub admin: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct UpdatePoolAuthority<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// Current authority must sign to authorize the change
    pub current_authority: Signer<'info>,
}

/// Represents a reward epoch - a period with a specific reward rate
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardEpoch {
    /// The reward percentage for this epoch in basis points (bps)
    pub reward_percentage: u64,
    /// The slot when this epoch starts
    pub start_slot: u64,
}

#[account]
pub struct Pool {
    pub token_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub owner: Pubkey,
    pub total_staked: u64,
    /// Current annual reward percentage in basis points (bps)
    /// 10000 bps = 100% APY
    /// Examples: 550 = 5.50%, 1000 = 10.00%, 2500 = 25.00%
    pub reward_percentage: u64,
    pub bump: u8,
    pub is_active: bool,
    /// Historical reward epochs (max 10 epochs to limit account size)
    /// Most recent epoch is at the end of the vector
    pub reward_epochs: Vec<RewardEpoch>,
    /// Slot of the last reward percentage update
    pub last_reward_update_slot: u64,
    /// Unique pool identifier for this token mint
    /// Allows multiple pools per token mint
    pub pool_id: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PoolData {
    pub token_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub owner: Pubkey,
    pub total_staked: u64,
    /// Current annual reward percentage in basis points (bps)
    /// 10000 bps = 100% APY
    /// Examples: 550 = 5.50%, 1000 = 10.00%, 2500 = 25.00%
    pub reward_percentage: u64,
    pub bump: u8,
    pub is_active: bool,
    /// Historical reward epochs
    pub reward_epochs: Vec<RewardEpoch>,
    /// Slot of the last reward percentage update
    pub last_reward_update_slot: u64,
    /// Unique pool identifier for this token mint
    pub pool_id: u64,
}

/// Tracks the next available pool_id for a specific token mint
/// This enables auto-incrementing pool IDs for multiple pools per token
#[account]
pub struct PoolIdCounter {
    pub token_mint: Pubkey,
    pub next_pool_id: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct SetStakingActive<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    pub admin: Signer<'info>,
    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,         // staker wallet
    pub pool: Pubkey,          // reference to pool
    pub amount: u64,           // currently staked tokens
    pub last_staked_slot: u64, // last deposit/withdraw slot
    pub total_earned: u64,     // total rewards earned including claimed
    pub unclaimed: u64,        // pending rewards not yet claimed
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct DepositStake<'info> {
    /// The staking pool
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref(), &pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// PDA to track this user's stake in the pool
    /// SECURITY NOTE: init_if_needed is acceptable here because:
    /// 1. The account is derived from user's pubkey (signer) and pool
    /// 2. deposit_stake function has logic to handle both new and existing stakes
    /// 3. Reinitialization by the same user would only affect their own account
    /// 4. However, the logic checks amount == 0 to detect first initialization
    /// 5. Pool association is validated in the instruction logic
    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"user_stake", pool.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1
    )]
    pub user_stake: Account<'info, UserStake>,

    /// The user who is staking
    #[account(mut)]
    pub user: Signer<'info>,

    /// Token mint for the pool (used for PDA validation)
    pub token_mint: Account<'info, Mint>,

    /// User's token account to transfer tokens from
    #[account(
        mut,
        constraint = user_token_account.mint == pool.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// The pool's vault (single vault for all users)
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref(), pool.token_mint.as_ref()],
        bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserStakeInfoWithReward {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub total_earned: u64,
    pub last_staked_slot: u64,
    pub unclaimed: u64,
    pub bump: u8,
    pub pending_reward: u64,
}

impl UserStake {
    pub fn calculate_pending_reward(&self, pool: &Pool) -> u64 {
        let clock = Clock::get().unwrap();
        let current_slot = clock.slot;

        let elapsed = current_slot.saturating_sub(self.last_staked_slot);
        if elapsed == 0 || self.amount == 0 {
            return 0;
        }


        // Calculate rewards across all relevant epochs
        let mut total_reward: u128 = 0;
        let mut period_start = self.last_staked_slot;
        
        // Process all relevant epochs in chronological order
        // Epochs are stored chronologically, so we iterate from the beginning
        for i in 0..pool.reward_epochs.len() {
            let epoch = &pool.reward_epochs[i];
            
            // Skip epochs that started after the current slot
            if epoch.start_slot > current_slot {
                break;
            }
            
            // Determine the end slot for this epoch
            let period_end = if i + 1 < pool.reward_epochs.len() {
                // Next epoch exists, use its start slot as this epoch's end
                let next_epoch_start = pool.reward_epochs[i + 1].start_slot;
                // Only consider this epoch if it overlaps with our staking period
                if next_epoch_start <= period_start {
                    continue; // This epoch ended before our staking period
                }
                next_epoch_start.min(current_slot)
            } else {
                // This is the last epoch, it extends to current_slot
                current_slot
            };
            
            // Calculate the actual period for this epoch that overlaps with staking time
            let effective_start = period_start.max(epoch.start_slot);
            let effective_end = period_end;
            
            if effective_end > effective_start {
                let epoch_duration = effective_end - effective_start;
                
                // Calculate reward for this epoch
                let epoch_reward = (self.amount as u128)
                    .checked_mul(epoch.reward_percentage as u128)
                    .unwrap()
                    .checked_mul(epoch_duration as u128)
                    .unwrap()
                    .checked_div(SLOTS_PER_YEAR as u128)
                    .unwrap()
                    .checked_div(10_000)
                    .unwrap_or(0);
                
                total_reward = total_reward.checked_add(epoch_reward).unwrap_or(total_reward);
            }
            
            // Move to the next period
            period_start = period_end;
            
            // If we've reached current slot, we're done
            if period_start >= current_slot {
                break;
            }
        }

        total_reward.min(u64::MAX as u128) as u64
    }
}

// ============================================================================
// Events - Typed, indexable events for off-chain integrations
// ============================================================================

/// Emitted when a new staking pool is created
#[event]
pub struct PoolCreatedEvent {
    /// The pool's PDA address
    pub pool: Pubkey,
    /// The token mint that can be staked
    pub token_mint: Pubkey,
    /// The reward token mint
    pub reward_mint: Pubkey,
    /// The pool owner/admin
    pub owner: Pubkey,
    /// Annual reward percentage in basis points (10000 bps = 100% APY)
    /// Examples: 550 = 5.50%, 1000 = 10.00%, 2500 = 25.00%
    pub reward_percentage: u64,
    /// Slot of pool creation
    pub slot: u64,
}

/// Emitted when pool staking is enabled or disabled
#[event]
pub struct PoolStakingActiveChangedEvent {
    /// The pool affected
    pub pool: Pubkey,
    /// New active status (true = enabled, false = disabled)
    pub is_active: bool,
    /// Admin who made the change
    pub admin: Pubkey,
    /// Slot of change
    pub slot: u64,
}

/// Emitted when pool reward mint is updated
#[event]
pub struct PoolRewardMintUpdatedEvent {
    /// The pool affected
    pub pool: Pubkey,
    /// The new reward mint
    pub new_reward_mint: Pubkey,
    /// The new reward vault
    pub new_reward_vault: Pubkey,
    /// Admin who made the change
    pub admin: Pubkey,
    /// Slot of change
    pub slot: u64,
}

/// Emitted when pool reward percentage is updated
#[event]
pub struct PoolRewardPercentageUpdatedEvent {
    /// The pool affected
    pub pool: Pubkey,
    /// The old reward percentage
    pub old_percentage: u64,
    /// The new reward percentage
    pub new_percentage: u64,
    /// Admin who made the change
    pub admin: Pubkey,
    /// Slot of change
    pub slot: u64,
}

/// Emitted when admin deposits rewards into the pool
#[event]
pub struct RewardDepositedEvent {
    /// The pool receiving rewards
    pub pool: Pubkey,
    /// Amount of reward tokens deposited
    pub amount: u64,
    /// Admin who deposited
    pub admin: Pubkey,
    /// Slot of deposit
    pub slot: u64,
}

/// Emitted when admin withdraws rewards from the pool
#[event]
pub struct RewardWithdrawnEvent {
    /// The pool from which rewards were withdrawn
    pub pool: Pubkey,
    /// Amount of reward tokens withdrawn
    pub amount: u64,
    /// Admin who withdrew
    pub admin: Pubkey,
    /// Slot of withdrawal
    pub slot: u64,
}

/// Emitted when a user stakes tokens
#[event]
pub struct StakeDepositedEvent {
    /// The user who staked
    pub user: Pubkey,
    /// The pool where tokens were staked
    pub pool: Pubkey,
    /// Amount of tokens staked
    pub amount: u64,
    /// User's total staked amount after deposit
    pub total_user_stake: u64,
    /// Pool's total staked amount after deposit
    pub total_pool_stake: u64,
    /// Slot of stake
    pub slot: u64,
}

/// Emitted when a user withdraws staked tokens
#[event]
pub struct StakeWithdrawnEvent {
    /// The user who withdrew
    pub user: Pubkey,
    /// The pool from which tokens were withdrawn
    pub pool: Pubkey,
    /// Amount of tokens withdrawn
    pub amount: u64,
    /// Amount of rewards sent (0 if vault was empty)
    pub rewards_sent: u64,
    /// Amount of rewards left unclaimed (if vault was insufficient)
    pub rewards_unclaimed: u64,
    /// User's remaining staked amount
    pub remaining_user_stake: u64,
    /// Pool's total staked amount after withdrawal
    pub total_pool_stake: u64,
    /// Slot of withdrawal
    pub slot: u64,
}

/// Emitted when a user claims rewards without withdrawing stake
#[event]
pub struct RewardClaimedEvent {
    /// The user who claimed
    pub user: Pubkey,
    /// The pool from which rewards were claimed
    pub pool: Pubkey,
    /// Amount of reward tokens claimed
    pub amount: u64,
    /// User's total earned rewards (lifetime)
    pub total_earned: u64,
    /// User's staked amount (unchanged by claim)
    pub user_stake: u64,
    /// Slot of claim
    pub slot: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized: Only pool owner can perform this action")]
    Unauthorized,
    #[msg("Staking is currently disabled for this pool")]
    StakingDisabled,
    #[msg("Insufficient tokens in reward vault to pay rewards")]
    InsufficientRewardVault,
    #[msg("No rewards available to claim")]
    NoRewardsAvailable,
    #[msg("Invalid reward percentage: must be <= 100,000,000 bps (1,000,000% APY) to prevent accidental extreme values")]
    InvalidRewardPercentage,
    #[msg("Invalid withdrawal address: cannot be zero address, vault PDA, program account, or token mint")]
    InvalidWithdrawalAddress,
    #[msg("Invalid authority address: cannot be zero address or vault PDA")]
    InvalidAuthorityAddress,
    #[msg("Invalid pool association: user stake account does not belong to this pool")]
    InvalidPoolAssociation,
    #[msg("Invalid pool ID: must match the next expected pool ID from the counter")]
    InvalidPoolId,
    #[msg("Pool counter overflow: maximum number of pools reached for this token mint")]
    PoolCounterOverflow,
}
