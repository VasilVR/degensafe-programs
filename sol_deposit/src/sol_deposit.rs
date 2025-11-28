use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("GYMDMX2rWcbuAQyRDBPKxnGuSe1RMrHir14CwBRdJjAP");

#[program]
pub mod vault_program {
    use super::*;

    // Initialize vault PDA (creates or resets state)
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.wallet_account = Pubkey::default();
        vault.balance = 0;
        vault.authority = ctx.accounts.authority.key();
        msg!("Vault initialized / refreshed by {}", vault.authority);
        Ok(())
    }

    // Deposit SOL into the vault PDA
    pub fn deposit(
        ctx: Context<Deposit>,
        order_id: String,
        amount: u64,
    ) -> Result<()> {
        let depositor = &ctx.accounts.depositor;
        let vault_pda = &ctx.accounts.vault_pda;
        let vault_state = &mut ctx.accounts.vault_state;

        require!(amount > 0, VaultError::InvalidAmount);

        // Transfer SOL → PDA
        let transfer_ix = Transfer {
            from: depositor.to_account_info(),
            to: vault_pda.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_ix);
        transfer(cpi_ctx, amount)?;

        vault_state.balance += amount;
        msg!("Deposited {} lamports to vault", amount);

        // Record deposit
        let record = &mut ctx.accounts.deposit_record;
        record.order_id = order_id.clone();
        record.timestamp = Clock::get()?.unix_timestamp;
        record.user = depositor.key();
        record.sol_amount = amount;

        msg!(
            "Deposit recorded: order_id={}, user={}, sol={}",
            order_id,
            depositor.key(),
            amount
        );

        Ok(())
    }

    // Withdraw all funds (admin only)
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        let wallet_account = &ctx.accounts.wallet_account;
        let vault_pda = &ctx.accounts.vault_pda;

        require!(
            vault_state.wallet_account != Pubkey::default(),
            VaultError::WalletNotSet
        );

        // PDA signer seeds
        let (_pda, bump) = Pubkey::find_program_address(&[b"vault_pda".as_ref()], ctx.program_id);
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault_pda".as_ref(), &[bump]]];

        // Transfer SOL → wallet
        let vault_balance = **vault_pda.to_account_info().lamports.borrow();
        require!(vault_balance > 0, VaultError::NoFunds);

        let transfer_ix = Transfer {
            from: vault_pda.to_account_info(),
            to: wallet_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_ix,
            signer_seeds,
        );
        transfer(cpi_ctx, vault_balance)?;

        vault_state.balance = 0;
        msg!(
            "Withdrawn {} lamports to {}",
            vault_balance,
            wallet_account.key()
        );

        Ok(())
    }

    // View deposit record
    pub fn check_deposit(ctx: Context<CheckDeposit>, _order_id: String) -> Result<DepositRecord> {
        let record = &ctx.accounts.deposit_record;

        Ok(DepositRecord {
            order_id: record.order_id.clone(),
            timestamp: record.timestamp,
            user: record.user,
            sol_amount: record.sol_amount,
        })
    }

    // View vault status
    pub fn check(ctx: Context<Check>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        msg!("🏦 Vault status:");
        msg!("• SOL balance: {}", vault_state.balance);
        msg!("• Withdrawal wallet: {}", vault_state.wallet_account);
        Ok(())
    }

    // Set withdrawal destination wallet
    pub fn set_withdrawal_account(
        ctx: Context<SetWithdrawalAccount>,
        new_wallet: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.wallet_account = new_wallet;
        msg!("Withdrawal wallet set to {}", new_wallet);
        Ok(())
    }
}

#[account]
pub struct DepositRecord {
    pub order_id: String,
    pub timestamp: i64,
    pub user: Pubkey,
    pub sol_amount: u64,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: PDA to hold SOL
    #[account(mut, seeds = [b"vault_pda".as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(mut, seeds = [b"vault_state".as_ref()], bump)]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = depositor,
        space = 8 + 4 + 64 + 8 + 32 + 8,
        seeds = [b"deposit_record", order_id.as_bytes()],
        bump
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault_state".as_ref()],
        bump,
        has_one = authority
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut, seeds = [b"vault_pda".as_ref()], bump)]
    /// CHECK: PDA holds SOL
    pub vault_pda: AccountInfo<'info>,

    /// CHECK: withdrawal destination wallet
    #[account(mut)]
    pub wallet_account: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Check<'info> {
    pub vault_state: Account<'info, VaultState>,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct CheckDeposit<'info> {
    #[account(seeds = [b"deposit_record", order_id.as_bytes()], bump)]
    pub deposit_record: Account<'info, DepositRecord>,
}

#[derive(Accounts)]
pub struct SetWithdrawalAccount<'info> {
    #[account(
        mut,
        seeds = [b"vault_state".as_ref()],
        bump,
        has_one = authority 
    )]
    pub vault_state: Account<'info, VaultState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct VaultState {
    pub wallet_account: Pubkey,
    pub balance: u64,
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 32 + 8 + 32,
        seeds = [b"vault_state".as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum VaultError {
    #[msg("Withdrawal wallet not set")]
    WalletNotSet,
    #[msg("No funds available for withdrawal")]
    NoFunds,
    #[msg("Deposit record not found")]
    DepositNotFound,
    #[msg("Invalid deposit amount")]
    InvalidAmount,
}