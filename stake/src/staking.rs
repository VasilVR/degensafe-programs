use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva");

#[program]
pub mod stake_program {
    use super::*;

    pub fn create_pool(
        ctx: Context<CreatePool>,
        maybe_owner: Option<Pubkey>,
        reward_percentage: u64,
    ) -> Result<()> {
        let pool_key = ctx.accounts.pool.key(); // immutable borrow first

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

        msg!("Staking pool created successfully!");
        msg!("Pool PDA: {}", pool_key); // use saved key
        msg!("Token mint: {}", pool.token_mint);
        msg!("Owner: {}", pool.owner);
        msg!("reward vault: {}", pool.reward_vault);

        Ok(())
    }

    pub fn get_pool_info(ctx: Context<GetPoolInfo>) -> Result<PoolData> {
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
        })
    }

    pub fn set_staking_active(ctx: Context<SetStakingActive>, active: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );
        pool.is_active = active;
        msg!(
            "Pool staking is now {}",
            if active { "enabled" } else { "disabled" }
        );
        Ok(())
    }

    pub fn update_reward_mint(ctx: Context<UpdateRewardMint>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Only the pool owner (admin) can update
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Update reward mint and vault
        pool.reward_mint = ctx.accounts.new_reward_mint.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();

        msg!(
            "Reward mint updated successfully to {}",
            pool.reward_mint
        );
        msg!("Pool reward vault updated to {}", pool.reward_vault);

        Ok(())
    }

    pub fn update_reward_percentage(
        ctx: Context<UpdateRewardPercentage>,
        new_percentage: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // Only pool owner can update
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        pool.reward_percentage = new_percentage;

        msg!("Reward percentage updated to {}", new_percentage);

        Ok(())
    }

    pub fn deposit_reward(ctx: Context<DepositReward>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        // Only pool owner can deposit
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        // Check if staking is active
        require!(pool.is_active, CustomError::StakingDisabled);

        // Transfer tokens from admin → reward_vault (PDA)
        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_reward_account.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        msg!("Reward deposited: {} tokens", amount);

        Ok(())
    }

    pub fn withdraw_reward(ctx: Context<WithdrawReward>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;

        // Only pool owner can withdraw
        require!(
            pool.owner == ctx.accounts.admin.key(),
            CustomError::Unauthorized
        );

        let seeds = &[
            b"staking_pool",
            ctx.accounts.pool.token_mint.as_ref(),
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

        msg!("Admin withdrew {} reward tokens", amount);

        Ok(())
    }

    pub fn deposit_stake(ctx: Context<DepositStake>, amount: u64) -> Result<()> {
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
            user_stake.owner = user.key();
            user_stake.pool = pool.key();
            user_stake.total_earned = 0;
            user_stake.unclaimed = 0;
            user_stake.bump = ctx.bumps.user_stake;
        } else {
            let pending = user_stake.calculate_pending_reward(pool);
            user_stake.unclaimed = user_stake.unclaimed.checked_add(pending).unwrap();
        }

        // Update user stake
        user_stake.amount = user_stake.amount.checked_add(amount).unwrap();
        user_stake.last_staked_time = clock.unix_timestamp;

        // Update pool info
        pool.total_staked = pool.total_staked.checked_add(amount).unwrap();

        msg!("{} tokens staked by {}", amount, user.key());
        msg!("   Total staked in pool: {}", pool.total_staked);

        Ok(())
    }

    pub fn get_user_stake_info(ctx: Context<GetUserStakeInfo>) -> Result<UserStakeData> {
        let user_stake = &ctx.accounts.user_stake;
        Ok(UserStakeData {
            owner: user_stake.owner,
            pool: user_stake.pool,
            amount: user_stake.amount,
            total_earned: user_stake.total_earned,
            last_staked_time: user_stake.last_staked_time,
            unclaimed: user_stake.unclaimed,
            bump: user_stake.bump,
        })
    }

    pub fn get_user_stake_with_reward(
        ctx: Context<GetUserStakeInfo>,
    ) -> Result<UserStakeInfoWithReward> {
        let user_stake = &ctx.accounts.user_stake;
        let pool = &ctx.accounts.pool;

        let pending_reward = user_stake.calculate_pending_reward(pool);

        Ok(UserStakeInfoWithReward {
            owner: user_stake.owner,
            pool: user_stake.pool,
            amount: user_stake.amount,
            total_earned: user_stake.total_earned,
            last_staked_time: user_stake.last_staked_time,
            unclaimed: user_stake.unclaimed,
            bump: user_stake.bump,
            pending_reward,
        })
    }

    pub fn withdraw_stake(ctx: Context<WithdrawStake>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user_stake = &mut ctx.accounts.user_stake;

        let clock = Clock::get()?; // get current timestamp

        // Check if pool is active
        require!(pool.is_active, CustomError::StakingDisabled);

        // Ensure user has enough staked
        require!(user_stake.amount >= amount, CustomError::Unauthorized);

        let pending = user_stake.calculate_pending_reward(pool);

        let reward_to_send = pending.checked_add(user_stake.unclaimed).unwrap();

        require!(
            ctx.accounts.reward_vault.amount >= reward_to_send,
            CustomError::InsufficientRewardVault
        );

        user_stake.total_earned = user_stake.total_earned.checked_add(reward_to_send).unwrap();

        user_stake.amount = user_stake.amount.checked_sub(amount).unwrap();

        user_stake.unclaimed = 0;
        user_stake.last_staked_time = clock.unix_timestamp;
        pool.total_staked = pool.total_staked.checked_sub(amount).unwrap();

        // 2️ Transfer tokens from pool vault -> user
        let seeds = &[b"staking_pool", pool.token_mint.as_ref(), &[pool.bump]];
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

        msg!("Withdrawn: {}", amount);
        msg!("Reward sent: {}", reward_to_send);
        msg!("Remaining stake: {}", user_stake.amount);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(maybe_owner: Option<Pubkey>, reward_percentage: u64)]
pub struct CreatePool<'info> {
    /// Pool account PDA, auto-created if doesn't exist
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump,
        space = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1

    )]
    pub pool: Account<'info, Pool>,

    /// Token mint for which the pool is created
    pub token_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"reward_vault", reward_mint.key().as_ref()],
        bump,
        token::mint = reward_mint,
        token::authority = pool
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// Pool vault PDA for user stakes (new)
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"vault", token_mint.key().as_ref()],
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
pub struct GetPoolInfo<'info> {
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct UpdateRewardMint<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// The new reward mint account
    pub new_reward_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = admin,
        seeds = [b"reward_vault", new_reward_mint.key().as_ref()],
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
pub struct DepositReward<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// Admin signs (must be pool.owner)
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = admin_reward_account.mint == pool.reward_mint
    )]
    pub admin_reward_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.reward_mint.as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct GetUserStakeInfo<'info> {
    pub user_stake: Account<'info, UserStake>,
    pub pool: Account<'info, Pool>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserStakeData {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub total_earned: u64,
    pub last_staked_time: i64,
    pub unclaimed: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

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
        seeds = [b"vault", pool.token_mint.as_ref()],
        bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.reward_mint.as_ref()],
        bump,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawReward<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// Admin signer (must be pool owner)
    pub admin: Signer<'info>,

    /// Admin's token account to receive rewards
    #[account(
        mut,
        constraint = admin_reward_account.mint == pool.reward_mint
    )]
    pub admin_reward_account: Account<'info, TokenAccount>,

    /// Pool's reward vault
    #[account(
        mut,
        seeds = [b"reward_vault", pool.reward_mint.as_ref()],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateRewardPercentage<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    pub admin: Signer<'info>,
}

#[account]
pub struct Pool {
    pub token_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub owner: Pubkey,
    pub total_staked: u64,
    pub reward_percentage: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PoolData {
    pub token_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub owner: Pubkey,
    pub total_staked: u64,
    pub reward_percentage: u64,
    pub bump: u8,
    pub is_active: bool, // new field to indicate if staking is enabled
}

#[derive(Accounts)]
pub struct SetStakingActive<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    pub admin: Signer<'info>,
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,         // staker wallet
    pub pool: Pubkey,          // reference to pool
    pub amount: u64,           // currently staked tokens
    pub last_staked_time: i64, // last deposit/withdraw timestamp
    pub total_earned: u64,     // total rewards earned including claimed
    pub unclaimed: u64,        // pending rewards not yet claimed
    pub bump: u8,
}

#[derive(Accounts)]
pub struct DepositStake<'info> {
    /// The staking pool
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// PDA to track this user's stake in the pool
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
        seeds = [b"vault", pool.token_mint.as_ref()],
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
    pub last_staked_time: i64,
    pub unclaimed: u64,
    pub bump: u8,
    pub pending_reward: u64,
}

impl UserStake {
    pub fn calculate_pending_reward(&self, pool: &Pool) -> u64 {
        let clock = Clock::get().unwrap();
        let current_time = clock.unix_timestamp;

        let elapsed = current_time - self.last_staked_time;
        if elapsed <= 0 || self.amount == 0 {
            return 0;
        }

        let seconds_per_year = 365_u64
            .checked_mul(24)
            .unwrap()
            .checked_mul(60)
            .unwrap()
            .checked_mul(60)
            .unwrap();

        let reward = (self.amount as u128)
            .checked_mul(pool.reward_percentage as u128)
            .unwrap()
            .checked_mul(elapsed as u128)
            .unwrap()
            .checked_div(seconds_per_year as u128)
            .unwrap()
            .checked_div(100)
            .unwrap_or(0); // fallback if something goes wrong

        reward.min(u64::MAX as u128) as u64
    }
}

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized: Only pool owner can perform this action")]
    Unauthorized,
    #[msg("Staking is currently disabled for this pool")]
    StakingDisabled,
    #[msg("Insufficient tokens in reward vault to pay rewards")]
    InsufficientRewardVault,
}
