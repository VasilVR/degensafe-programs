use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("4cCYbBAvp5Pou9XChxG4wfRMzSvajrXQjHdbevyEqXyG");

#[program]
pub mod order_deposit {
    use super::*;

    pub const PRICE: u64 = 2_000_000; // 2 tokens with 9 decimals

    pub fn deposit(ctx: Context<Deposit>, order_id: String, nonce: u64) -> Result<()> {
        let deposit_account = &mut ctx.accounts.deposit_account;

        // Check if already deposited
        require!(!deposit_account.exists, ErrorCode::AlreadyDeposited);

        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token::transfer(CpiContext::new(cpi_program, cpi_accounts), PRICE)?;

        // Save deposit info
        deposit_account.order_id = order_id;
        deposit_account.nonce = nonce;
        deposit_account.timestamp = Clock::get()?.unix_timestamp;
        deposit_account.exists = true;
        deposit_account.user = *ctx.accounts.user.key;
        deposit_account.amount = PRICE;

        Ok(())
    }

    pub fn check(ctx: Context<Check>) -> Result<(bool, i64)> {
        let deposit_account = &ctx.accounts.deposit_account;
        Ok((deposit_account.exists, deposit_account.timestamp))
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault_balance = ctx.accounts.vault_token_account.amount;

        require!(vault_balance > 0, ErrorCode::NoTokensInVault);

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.receiver_token_account.to_account_info(),
            authority: ctx.accounts.vault_token_account_authority.to_account_info(),
        };

        let vault_authority_seeds: &[&[u8]] = &[
            b"vault-authority",
            &[ctx.bumps.vault_token_account_authority],
        ];

        let cpi_program = ctx.accounts.token_program.to_account_info();

        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, &[vault_authority_seeds]),
            vault_balance,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(order_id: String, nonce: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut,
        constraint = user_token_account.mint == vault_token_account.mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + (order_id.len() + 4) + 8 + 8 + 1 + 32 + 8,
        seeds = [order_id.as_bytes(), &nonce.to_le_bytes()],
        bump
    )]
    pub deposit_account: Account<'info, DepositAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(order_id: String, nonce: u64)]
pub struct Check<'info> {
    #[account(
        seeds = [order_id.as_bytes(), &nonce.to_le_bytes()],
        bump
    )]
    pub deposit_account: Account<'info, DepositAccount>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub caller: Signer<'info>, // anyone can call

    #[account(mut,
        constraint = receiver_token_account.owner == caller.key()
    )]
    pub receiver_token_account: Account<'info, TokenAccount>, // where funds go

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA authority for vault_token_account
    #[account(
        seeds = [b"vault-authority"],
        bump
    )]
    pub vault_token_account_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct DepositAccount {
    pub order_id: String,
    pub nonce: u64,
    pub timestamp: i64,
    pub exists: bool,
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Deposit already exists for this order ID and nonce.")]
    AlreadyDeposited,
    #[msg("No tokens available in the vault account.")]
    NoTokensInVault,
    #[msg("Invalid vault authority.")]
    InvalidVaultAuthority,
}
