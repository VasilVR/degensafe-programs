// =============================================================================
// DEPLOYMENT NOTICE
// =============================================================================
// This program should be deployed with its dependent programs
// (stake_program, spl-token-vault) to ensure consistent security boundaries.
// =============================================================================

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("9UmM8nNR6Lxa8NFyTbG2gVfohQVwq5cNQoChVora19gf");

// Maximum order_id length (constrained by PDA seed limits).
// Solana's PDA derivation enforces this limit implicitly.
// AUDIT NOTE (L-08): Order ID length is not explicitly validated at runtime because
// PDA seed derivation enforces an implicit length limit. Exceeding it causes a clear
// PDA derivation failure. Backend validates order IDs before submission as defense-in-depth.
pub const MAX_ORDER_ID_LEN: usize = 32;

#[program]
pub mod sol_vault_program {
    use super::*;

    /// Initialize vault PDA. One-time initialization only.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let clock = Clock::get()?;
        
        // Derive vault PDA for event
        let (vault_pda_key, _) = Pubkey::find_program_address(&[b"vault_pda"], ctx.program_id);
        
        // Save values before mutable borrow
        let vault_state_key = ctx.accounts.vault_state.key();
        let authority_key = ctx.accounts.authority.key();
        
        let vault = &mut ctx.accounts.vault_state;
        vault.wallet_account = Pubkey::default();
        vault.authority = authority_key;
        
        emit!(VaultInitializedEvent {
            vault_state: vault_state_key,
            vault_pda: vault_pda_key,
            authority: authority_key,
            timestamp: clock.unix_timestamp,
        });
        
        msg!("Vault initialized by {}", authority_key);
        Ok(())
    }

    /// Deposit SOL into the vault PDA.
    pub fn deposit(
        ctx: Context<Deposit>,
        order_id: String,
        amount: u64,
    ) -> Result<()> {
        let depositor = &ctx.accounts.depositor;
        let vault_pda = &ctx.accounts.vault_pda;

        require!(amount > 0, VaultError::InvalidAmount);
        require!(!order_id.is_empty(), VaultError::OrderIdEmpty);

        // Transfer SOL → PDA
        let transfer_ix = Transfer {
            from: depositor.to_account_info(),
            to: vault_pda.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_ix);
        transfer(cpi_ctx, amount)?;

        msg!("Deposited {} lamports to vault", amount);

        // Save keys before mutable borrow
        let deposit_record_key = ctx.accounts.deposit_record.key();
        let depositor_key = depositor.key();
        
        // Record deposit
        let record = &mut ctx.accounts.deposit_record;
        let clock = Clock::get()?;
        record.order_id = order_id.clone();
        record.timestamp = clock.unix_timestamp;
        record.user = depositor_key;
        record.sol_amount = amount;
        
        emit!(DepositEvent {
            depositor: depositor_key,
            order_id: order_id.clone(),
            amount,
            deposit_record: deposit_record_key,
            timestamp: record.timestamp,
        });

        msg!(
            "Deposit recorded: order_id={}, user={}, sol={}",
            order_id,
            depositor_key,
            amount
        );

        Ok(())
    }

    /// Withdraw all funds (admin only).
    /// BEST PRACTICE: This instruction does NOT take wallet_account as a named parameter.
    /// Instead, it must be provided via remainingAccounts and is validated to match
    /// the preconfigured wallet stored in vault_state.wallet_account.
    /// 
    /// The caller must provide the wallet account in remainingAccounts[0] (for Solana transaction handling),
    /// but the program enforces it can ONLY be the preconfigured wallet, not any arbitrary address.
    /// 
    /// Reasons:
    /// - Security: Eliminates attack surface by preventing any possibility of sending to an unintended address
    /// - Auditability: Single source of truth for withdrawal destination makes auditing simpler
    /// - Admin UX: Configure once via set_withdrawal_account, then all withdrawals enforce that address
    /// - Intent clarity: The validation makes it explicit that withdrawals always use the configured wallet
    pub fn withdraw<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let vault_pda = &ctx.accounts.vault_pda;

        require!(
            vault_state.wallet_account != Pubkey::default(),
            VaultError::WalletNotSet
        );

        // Get wallet account from remaining accounts
        let remaining_accounts = &ctx.remaining_accounts;
        require!(
            !remaining_accounts.is_empty(),
            VaultError::WalletAccountMissing
        );
        
        let wallet_account_info = remaining_accounts.get(0)
            .ok_or(VaultError::WalletAccountMissing)?;
        
        // Verify that the provided wallet account matches the configured one
        require!(
            wallet_account_info.key() == vault_state.wallet_account,
            VaultError::WalletAccountMismatch
        );

        // PDA signer seeds
        let (_pda, bump) = Pubkey::find_program_address(&[b"vault_pda".as_ref()], ctx.program_id);
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault_pda".as_ref(), &[bump]]];

        // Transfer SOL → wallet (keep rent-exempt minimum)
        let vault_balance = **vault_pda.to_account_info().lamports.borrow();
        let rent = Rent::get()?;
        let min_rent_exempt = rent.minimum_balance(vault_pda.to_account_info().data_len());
        
        // Calculate withdrawable amount (total - rent exempt)
        let withdrawable = vault_balance.saturating_sub(min_rent_exempt);
        require!(withdrawable > 0, VaultError::NoFunds);

        let transfer_ix = Transfer {
            from: vault_pda.to_account_info(),
            to: wallet_account_info.clone(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_ix,
            signer_seeds,
        );
        transfer(cpi_ctx, withdrawable)?;

        let clock = Clock::get()?;
        
        emit!(WithdrawEvent {
            vault_state: vault_state.key(),
            wallet_account: vault_state.wallet_account,
            amount: withdrawable,
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Withdrawn {} lamports to {} (kept {} for rent)",
            withdrawable,
            vault_state.wallet_account,
            min_rent_exempt
        );

        Ok(())
    }

    /// View deposit record.
    pub fn check_deposit(ctx: Context<CheckDeposit>, _order_id: String) -> Result<DepositRecord> {
        let record = &ctx.accounts.deposit_record;
        let depositor = &ctx.accounts.depositor;

        // Validate that the provided depositor matches the user in the record
        require_keys_eq!(
            record.user,
            depositor.key(),
            VaultError::DepositNotFound
        );

        Ok(DepositRecord {
            order_id: record.order_id.clone(),
            timestamp: record.timestamp,
            user: record.user,
            sol_amount: record.sol_amount,
        })
    }

    /// View vault status.
    pub fn check(ctx: Context<Check>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let vault_pda = &ctx.accounts.vault_pda;
        
        // Read actual balance from vault account
        let vault_balance = **vault_pda.to_account_info().lamports.borrow();
        
        msg!("Vault status:");
        msg!("SOL balance: {}", vault_balance);
        msg!("Withdrawal wallet: {}", vault_state.wallet_account);
        Ok(())
    }

    /// Set withdrawal destination wallet.
    pub fn set_withdrawal_account(
        ctx: Context<SetWithdrawalAccount>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        let new_wallet = ctx.accounts.new_wallet.key();
        
        // Derive vault PDAs for validation
        let (vault_state_pda, _) = Pubkey::find_program_address(&[b"vault_state"], ctx.program_id);
        let (vault_pda, _) = Pubkey::find_program_address(&[b"vault_pda"], ctx.program_id);
        
        // Validation: Disallow setting withdrawal wallet to:
        // 1. Default public key (Pubkey::default())
        // 2. Program account (program ID)
        // 3. System program account
        // 4. Vault state PDA
        // 5. Vault PDA
        require!(
            new_wallet != Pubkey::default() &&
            new_wallet != crate::ID &&
            new_wallet != anchor_lang::system_program::ID &&
            new_wallet != vault_state_pda &&
            new_wallet != vault_pda,
            VaultError::InvalidWithdrawalWallet
        );
        
        vault.wallet_account = new_wallet;
        
        let clock = Clock::get()?;
        
        emit!(WithdrawalWalletUpdatedEvent {
            vault_state: vault.key(),
            new_wallet,
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        
        msg!("Withdrawal wallet set to {}", new_wallet);
        Ok(())
    }

    /// Update vault authority (transfer admin rights).
    pub fn update_authority(
        ctx: Context<UpdateAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        // Validate new authority is not the default/system key
        require!(
            new_authority != Pubkey::default(),
            VaultError::InvalidNewAuthority
        );

        // Validate new authority is not the vault PDA (to prevent locking)
        let (vault_pda_key, _) = Pubkey::find_program_address(&[b"vault_pda"], ctx.program_id);
        require!(
            new_authority != vault_pda_key,
            VaultError::AuthorityCannotBeVaultAccount
        );

        // Validate new authority is not the vault state PDA
        let vault_state_key = ctx.accounts.vault_state.key();
        require!(
            new_authority != vault_state_key,
            VaultError::AuthorityCannotBeVaultAccount
        );

        // Save previous authority before update
        let previous_authority = ctx.accounts.vault_state.authority;
        
        // Update the authority
        let vault = &mut ctx.accounts.vault_state;
        vault.authority = new_authority;
        
        let clock = Clock::get()?;
        
        emit!(AuthorityUpdatedEvent {
            vault_state: vault_state_key,
            previous_authority,
            new_authority,
            timestamp: clock.unix_timestamp,
        });
        
        msg!(
            "Authority updated from {} to {}",
            previous_authority,
            new_authority
        );
        
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

    // AUDIT NOTE (I-03): The vault PDA is not explicitly initialized. The first deposit must
    // include enough SOL to cover the rent-exempt minimum (~890,880 lamports for 0 bytes).
    // Deployment scripts should bootstrap this with an initial deposit.
    /// CHECK: PDA to hold SOL
    #[account(mut, seeds = [b"vault_pda".as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,

    #[account(mut, seeds = [b"vault_state".as_ref()], bump)]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = depositor,
        space = 8 + 4 + MAX_ORDER_ID_LEN + 8 + 32 + 8,
        seeds = [b"deposit_record", depositor.key().as_ref(), order_id.as_bytes()],
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

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Check<'info> {
    #[account(seeds = [b"vault_state".as_ref()], bump)]
    pub vault_state: Account<'info, VaultState>,
    
    /// CHECK: PDA holds SOL
    #[account(seeds = [b"vault_pda".as_ref()], bump)]
    pub vault_pda: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct CheckDeposit<'info> {
    #[account(seeds = [b"deposit_record", depositor.key().as_ref(), order_id.as_bytes()], bump)]
    pub deposit_record: Account<'info, DepositRecord>,
    
    /// CHECK: The depositor public key used in PDA derivation
    pub depositor: UncheckedAccount<'info>,
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
    
    /// CHECK: new wallet to set
    pub new_wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
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
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// SECURITY: Using 'init' instead of 'init_if_needed' to prevent reinitialization attacks
    /// This ensures the vault can only be initialized once, preventing authority takeover
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32, // discriminator + wallet_account + authority
        seeds = [b"vault_state".as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events - Typed, indexable events for off-chain integrations
// ============================================================================

/// Emitted when the vault is initialized
#[event]
pub struct VaultInitializedEvent {
    /// The vault state PDA
    pub vault_state: Pubkey,
    /// The vault PDA that holds SOL
    pub vault_pda: Pubkey,
    /// The authority who initialized the vault
    pub authority: Pubkey,
    /// Timestamp of initialization
    pub timestamp: i64,
}

/// Emitted when SOL is deposited into the vault
#[event]
pub struct DepositEvent {
    /// The user who deposited
    pub depositor: Pubkey,
    /// The unique order ID for this deposit
    pub order_id: String,
    /// Amount of SOL deposited (in lamports)
    pub amount: u64,
    /// The deposit record PDA
    pub deposit_record: Pubkey,
    /// Timestamp of deposit
    pub timestamp: i64,
}

/// Emitted when SOL is withdrawn from the vault (admin only)
#[event]
pub struct WithdrawEvent {
    /// The vault from which funds were withdrawn
    pub vault_state: Pubkey,
    /// The wallet that received the withdrawal
    pub wallet_account: Pubkey,
    /// Amount withdrawn (in lamports)
    pub amount: u64,
    /// Authority who authorized the withdrawal
    pub authority: Pubkey,
    /// Timestamp of withdrawal
    pub timestamp: i64,
}

/// Emitted when the withdrawal wallet is set or updated
#[event]
pub struct WithdrawalWalletUpdatedEvent {
    /// The vault affected
    pub vault_state: Pubkey,
    /// The new withdrawal wallet
    pub new_wallet: Pubkey,
    /// Authority who made the change
    pub authority: Pubkey,
    /// Timestamp of change
    pub timestamp: i64,
}

/// Emitted when the vault authority is updated
#[event]
pub struct AuthorityUpdatedEvent {
    /// The vault affected
    pub vault_state: Pubkey,
    /// The previous authority
    pub previous_authority: Pubkey,
    /// The new authority
    pub new_authority: Pubkey,
    /// Timestamp of change
    pub timestamp: i64,
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
    #[msg("Wallet account not provided in remaining accounts")]
    WalletAccountMissing,
    #[msg("Provided wallet account does not match configured withdrawal wallet")]
    WalletAccountMismatch,
    #[msg("Invalid withdrawal wallet: cannot be default, program account, or system account")]
    InvalidWithdrawalWallet,
    #[msg("Invalid new authority: cannot be default/system key")]
    InvalidNewAuthority,
    #[msg("Authority cannot be a vault account (PDA)")]
    AuthorityCannotBeVaultAccount,
    #[msg("Order ID cannot be empty")]
    OrderIdEmpty,
}
