use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, get_associated_token_address, Create},
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("BYZYa8ifZSoX2UjAu9X7ZaWhy6ZHkAq8kKEMksJFo9Ly");

#[program]
pub mod lc_vault_program {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.authority = ctx.accounts.authority.key();
        vault_state.token_mint = ctx.accounts.token_mint.key();
        vault_state.wallet_account = Pubkey::default();
        vault_state.balance = 0;

        msg!(
            "Vault initialized for token mint: {}",
            vault_state.token_mint
        );
        Ok(())
    }

    pub fn check(ctx: Context<Check>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let vault_token_account = &ctx.accounts.vault_token_account;

        msg!("Vault status:");
        msg!("Token mint: {}", vault_state.token_mint);
        msg!("Token balance (on-chain): {}", vault_token_account.amount);
        msg!("Recorded balance (state): {}", vault_state.balance);
        msg!("Withdrawal wallet: {}", vault_state.wallet_account);
        msg!("Authority: {}", vault_state.authority);
        Ok(())
    }

    pub fn check_deposit(ctx: Context<CheckDeposit>, _order_id: String) -> Result<DepositRecord> {
        let record = &ctx.accounts.deposit_record;
        let token_mint = &ctx.accounts.token_mint;

        require_keys_eq!(
            record.token_mint,
            token_mint.key(),
            VaultError::MintMismatch
        );

        msg!("Checking deposit record for mint: {}", token_mint.key());

        Ok(DepositRecord {
            order_id: record.order_id.clone(),
            user: record.user,
            token_mint: record.token_mint,
            amount: record.amount,
            timestamp: record.timestamp,
        })
    }
pub fn set_withdrawal_account(
    ctx: Context<SetWithdrawalAccount>,
    new_wallet: Pubkey,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    vault.wallet_account = new_wallet;
    msg!("Setting withdrawal wallet to {}", new_wallet);

    let token_mint = &ctx.accounts.token_mint;
    let ata = get_associated_token_address(&new_wallet, &token_mint.key());
    msg!("Checking ATA for wallet {}", new_wallet);
    msg!("Token mint: {}", token_mint.key());
    msg!("Expected ATA: {}", ata);

    let ata_account_info = ctx.accounts.associated_token.to_account_info();

    // If already owned by Token Program, it's an existing ATA — skip
    if ata_account_info.owner == &token::ID {
        msg!("ATA already exists: {}", ata);
    } else {
        msg!("Creating new ATA at {}", ata);

        let create_ctx = CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            Create {
                payer: ctx.accounts.authority.to_account_info(),
                associated_token: ctx.accounts.associated_token.to_account_info(),
                authority: ctx.accounts.new_wallet.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        );

        associated_token::create(create_ctx)?;
        msg!("ATA created successfully for wallet {}", new_wallet);
    }

    Ok(())
}

    pub fn deposit(ctx: Context<Deposit>, order_id: String, amount: u64) -> Result<()> {
        let user = &ctx.accounts.user;
        let vault_state = &mut ctx.accounts.vault_state;
        let user_token_account = &ctx.accounts.user_token_account;
        let vault_token_account = &ctx.accounts.vault_token_account;

        require!(amount > 0, VaultError::InvalidAmount);

        // Transfer tokens → vault_token_account
        let transfer_ix = token::Transfer {
            from: user_token_account.to_account_info(),
            to: vault_token_account.to_account_info(),
            authority: user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_ix);
        token::transfer(cpi_ctx, amount)?;

        // Update vault balance
        vault_state.balance += amount;

        // Store deposit record
        let record = &mut ctx.accounts.deposit_record;
        record.order_id = order_id.clone();
        record.user = user.key();
        record.amount = amount;
        record.timestamp = Clock::get()?.unix_timestamp;
        record.token_mint = vault_state.token_mint;

        msg!(
            "Deposit recorded | user={} | order_id={} | amount={}",
            record.user,
            order_id,
            amount
        );

        Ok(())
    }

    // Withdraw all tokens (admin only)
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        let vault_token_account = &ctx.accounts.vault_token_account;
        let destination_token_account = &ctx.accounts.destination_token_account;
        let authority = &ctx.accounts.authority;

        require!(
            vault_state.wallet_account != Pubkey::default(),
            VaultError::WalletNotSet
        );
        require_keys_eq!(
            vault_state.authority,
            authority.key(),
            VaultError::Unauthorized
        );

        let amount = vault_token_account.amount;
        require!(amount > 0, VaultError::NoFunds);

        // Transfer all tokens → destination wallet ATA
        let seeds = &[
            b"vault_state",
            vault_state.token_mint.as_ref(),
            &[ctx.bumps.vault_state],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_ix = Transfer {
            from: vault_token_account.to_account_info(),
            to: destination_token_account.to_account_info(),
            authority: vault_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_ix,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        vault_state.balance = 0;

        msg!(
            "💸 Withdrawn {} tokens to wallet {}",
            amount,
            destination_token_account.key()
        );
        Ok(())
    }

    pub fn create_wallet_ata_if_needed(
        ctx: Context<CreateWalletAtaIfNeeded>,
        wallet: Pubkey,
    ) -> Result<Pubkey> {
        let mint = &ctx.accounts.token_mint;

        // Derive ATA address
        let ata = get_associated_token_address(&wallet, &mint.key());
        msg!("Checking ATA for wallet {}", wallet);
        msg!("Token mint: {}", mint.key());
        msg!("Expected ATA: {}", ata);

        // Check if ATA already exists
        let account_info = ctx.accounts.associated_token.to_account_info();
        if account_info.owner != &System::id() {
            msg!("ATA already exists: {}", ata);
            return Ok(ata);
        }

        // Create ATA if missing
        msg!("Creating new ATA at {}", ata);
        associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: ctx.accounts.associated_token.to_account_info(),
                authority: ctx.accounts.wallet.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;

        msg!("ATA created successfully: {}", ata);
        Ok(ata)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 8,
        seeds = [b"vault_state", token_mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = token_mint,
        associated_token::authority = vault_state
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Check<'info> {
    #[account(
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        associated_token::mint = vault_state.token_mint,
        associated_token::authority = vault_state
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct SetWithdrawalAccount<'info> {
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump,
        has_one = authority
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: new wallet to set
    pub new_wallet: UncheckedAccount<'info>,

    /// CHECK: ATA may or may not exist
    #[account(mut)]
    pub associated_token: UncheckedAccount<'info>,

    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = vault_state.token_mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        associated_token::mint = vault_state.token_mint,
        associated_token::authority = vault_state
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    // safer PDA seed: mint + order_id
    #[account(
        init,
        payer = user,
        space = 8 + 4 + 64 + 32 + 32 + 8 + 8, // extra 32 for token_mint
        seeds = [b"deposit_record", vault_state.token_mint.as_ref(), order_id.as_bytes()],
        bump
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct DepositRecord {
    pub order_id: String,
    pub user: Pubkey,
    pub token_mint: Pubkey, // added for safety
    pub amount: u64,
    pub timestamp: i64,
}

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub wallet_account: Pubkey,
    pub balance: u64,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct CheckDeposit<'info> {
    #[account(
        seeds = [b"deposit_record", token_mint.key().as_ref(), order_id.as_bytes()],
        bump
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub token_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump,
        has_one = authority
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        associated_token::mint = vault_state.token_mint,
        associated_token::authority = vault_state
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = vault_state.token_mint,
        associated_token::authority = vault_state.wallet_account
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CreateWalletAtaIfNeeded<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This is the wallet to check/create ATA for
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,

    /// CHECK: ATA may or may not exist yet
    #[account(mut)]
    pub associated_token: UncheckedAccount<'info>,

    pub token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum VaultError {
    #[msg("Invalid deposit amount")]
    InvalidAmount,
    #[msg("Token mint mismatch")]
    MintMismatch,
    #[msg("No funds available for withdrawal")]
    NoFunds,
    #[msg("Withdrawal wallet not set")]
    WalletNotSet,
    #[msg("Unauthorized access")]
    Unauthorized,
}
