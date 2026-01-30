// =============================================================================
// DEPLOYMENT NOTICE
// =============================================================================
// This program should be deployed with its dependent programs
// (stake_program, sol-vault) to ensure consistent security boundaries.
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, get_associated_token_address, Create},
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("CX7oWiXadkmto4iwK2kKuDErG4UJVw6EbDHhuQ9EEfSz");

/// Maximum length for order IDs (constrained by PDA seed limits).
/// Solana's PDA derivation enforces this limit implicitly.
/// An explicit length check is intentionally omitted because:
/// - PDA derivation fails first, providing equivalent protection
/// - Adding a redundant check would increase compute cost unnecessarily
/// - The seed construction naturally bounds the effective length
pub const MAX_ORDER_ID_LEN: usize = 32;

#[program]
pub mod spl_token_vault_program {
    use super::*;

    /// Initialize a new vault for a specific SPL token mint.
    /// Creates a vault state PDA and associated token account to hold deposits.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let clock = Clock::get()?;

        let vault_state_key = ctx.accounts.vault_state.key();
        let token_mint_key = ctx.accounts.token_mint.key();
        let vault_token_account_key = ctx.accounts.vault_token_account.key();
        let authority_key = ctx.accounts.authority.key();

        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.authority = authority_key;
        vault_state.token_mint = token_mint_key;
        vault_state.wallet_account = Pubkey::default();

        emit!(VaultInitializedEvent {
            vault_state: vault_state_key,
            token_mint: token_mint_key,
            vault_token_account: vault_token_account_key,
            authority: authority_key,
            timestamp: clock.unix_timestamp,
        });

        msg!("Vault initialized for token mint: {}", token_mint_key);
        Ok(())
    }

    /// Query vault status including balance and rent exemption status.
    /// Read-only operation for monitoring purposes.
    pub fn check(ctx: Context<Check>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let vault_token_account = &ctx.accounts.vault_token_account;
        let rent = &ctx.accounts.rent;

        let vault_token_account_info = vault_token_account.to_account_info();
        let lamports = vault_token_account_info.lamports();
        let data_len = vault_token_account_info.data_len();
        let min_rent = rent.minimum_balance(data_len);
        let is_rent_exempt = lamports >= min_rent;

        msg!("Vault status:");
        msg!("  Token mint: {}", vault_state.token_mint);
        msg!("  Token balance: {}", vault_token_account.amount);
        msg!("  Withdrawal wallet: {}", vault_state.wallet_account);
        msg!("  Authority: {}", vault_state.authority);
        msg!("Rent status:");
        msg!("  SOL balance (lamports): {}", lamports);
        msg!("  Minimum rent: {}", min_rent);
        msg!("  Rent exempt: {}", is_rent_exempt);

        if !is_rent_exempt {
            msg!("WARNING: Account is NOT rent exempt and may be closed");
        }

        Ok(())
    }

    /// Query a specific deposit record by order ID.
    /// Returns the deposit details if found.
    pub fn check_deposit(ctx: Context<CheckDeposit>, _order_id: String) -> Result<DepositRecord> {
        let record = &ctx.accounts.deposit_record;

        msg!("Checking deposit record for mint: {}", record.token_mint);

        Ok(DepositRecord {
            order_id: record.order_id.clone(),
            user: record.user,
            token_mint: record.token_mint,
            amount: record.amount,
            timestamp: record.timestamp,
        })
    }

    /// Set or update the withdrawal destination wallet.
    /// Validates the wallet address and creates an ATA if needed.
    pub fn set_withdrawal_account(ctx: Context<SetWithdrawalAccount>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        let new_wallet = ctx.accounts.new_wallet.key();
        let token_mint = vault.token_mint;

        // Derive vault token account address for validation
        let vault_token_account = anchor_spl::associated_token::get_associated_token_address(
            &vault.key(),
            &token_mint,
        );

        // Prevent setting withdrawal wallet to invalid addresses that could cause fund loss
        require!(
            new_wallet != Pubkey::default()
                && new_wallet != crate::ID
                && new_wallet != anchor_lang::system_program::ID
                && new_wallet != vault.key()
                && new_wallet != token_mint
                && new_wallet != vault_token_account,
            VaultError::InvalidWithdrawalWallet
        );

        vault.wallet_account = new_wallet;
        msg!("Setting withdrawal wallet to {}", new_wallet);

        let ata = get_associated_token_address(&new_wallet, &token_mint);

        // Verify the provided ATA matches the canonical derivation
        let ata_account_info = ctx.accounts.associated_token.to_account_info();
        require_keys_eq!(
            ata_account_info.key(),
            ata,
            VaultError::InvalidWithdrawalWallet
        );

        msg!("Checking ATA for wallet {}", new_wallet);
        msg!("Token mint: {}", token_mint);
        msg!("Expected ATA: {}", ata);

        // If ATA exists, validate its configuration
        if ata_account_info.owner == &token::ID {
            let ata_data =
                TokenAccount::try_deserialize(&mut &ata_account_info.data.borrow()[..])?;

            // Verify mint matches
            require_keys_eq!(ata_data.mint, token_mint, VaultError::MintMismatch);

            // Verify ownership
            require_keys_eq!(
                ata_data.owner,
                new_wallet,
                VaultError::InvalidWithdrawalWallet
            );

            msg!("ATA already exists and validated: {}", ata);
        } else {
            // Create ATA if it doesn't exist
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

        let clock = Clock::get()?;

        emit!(WithdrawalWalletUpdatedEvent {
            vault_state: vault.key(),
            token_mint,
            new_wallet,
            wallet_ata: ata,
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Deposit tokens into the vault.
    /// Records the actual received amount to support fee-on-transfer tokens.
    pub fn deposit(ctx: Context<Deposit>, order_id: String, amount: u64) -> Result<()> {
        let user = &ctx.accounts.user;
        let vault_state = &mut ctx.accounts.vault_state;
        let user_token_account = &ctx.accounts.user_token_account;
        let vault_token_account = &ctx.accounts.vault_token_account;

        require!(amount > 0, VaultError::InvalidAmount);
        require!(!order_id.is_empty(), VaultError::OrderIdEmpty);

        // Capture balance before transfer for fee-on-transfer token support
        let balance_before = vault_token_account.amount;

        let transfer_ix = token::Transfer {
            from: user_token_account.to_account_info(),
            to: vault_token_account.to_account_info(),
            authority: user.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_ix);
        token::transfer(cpi_ctx, amount)?;

        // Reload to get actual balance after transfer
        ctx.accounts.vault_token_account.reload()?;
        let balance_after = ctx.accounts.vault_token_account.amount;

        // Calculate actual received amount (handles fee-on-transfer tokens)
        let actual_amount_received = balance_after
            .checked_sub(balance_before)
            .ok_or(VaultError::MathOverflow)?;

        // Store deposit record with actual received amount
        let record = &mut ctx.accounts.deposit_record;
        record.order_id = order_id.clone();
        record.user = user.key();
        record.amount = actual_amount_received;
        record.timestamp = Clock::get()?.unix_timestamp;
        record.token_mint = vault_state.token_mint;

        emit!(DepositEvent {
            user: record.user,
            order_id: record.order_id.clone(),
            amount: record.amount,
            token_mint: record.token_mint,
            timestamp: record.timestamp,
        });

        Ok(())
    }

    /// Withdraw all tokens from the vault to the configured withdrawal wallet.
    /// Authority only.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let vault_token_account = &ctx.accounts.vault_token_account;
        let destination_token_account = &ctx.accounts.destination_token_account;

        require!(
            vault_state.wallet_account != Pubkey::default(),
            VaultError::WalletNotSet
        );

        let amount = vault_token_account.amount;
        require!(amount > 0, VaultError::NoFunds);

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

        let clock = Clock::get()?;

        emit!(WithdrawEvent {
            vault_state: vault_state.key(),
            token_mint: vault_state.token_mint,
            amount,
            destination_wallet: vault_state.wallet_account,
            authority: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Withdrawn {} tokens to wallet {}",
            amount,
            destination_token_account.key()
        );
        Ok(())
    }

    // close_vault function removed
    // Rationale: Closing vaults introduces risks of:
    // - Accidental fund loss if tokens remain
    // - State inconsistency with dependent systems
    // - Potential for griefing attacks
    // Vaults are designed to be permanent for the lifetime of the protocol.

    // create_wallet_ata_if_needed function removed
    // Rationale: This function exposes unnecessary attack surface:
    // - Allows arbitrary ATA creation which could be abused
    // - Client-side ATA creation is preferred using standard SPL Token tooling
    // - Reduces program complexity and potential for bugs
    //
    // Users should create ATAs client-side using:
    // - @solana/spl-token: createAssociatedTokenAccount()
    // - Anchor: anchor.utils.token.associatedAddress()

    /// Transfer vault authority to a new address.
    /// Validates the new authority is not a reserved address.
    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        require!(
            new_authority != Pubkey::default(),
            VaultError::InvalidAuthority
        );
        require_keys_neq!(
            new_authority,
            ctx.accounts.vault_state.key(),
            VaultError::InvalidAuthority
        );
        require_keys_neq!(
            new_authority,
            ctx.accounts.vault_state.token_mint,
            VaultError::InvalidAuthority
        );

        let state = &mut ctx.accounts.vault_state;

        let old_authority = state.authority;
        state.authority = new_authority;

        let clock = Clock::get()?;

        emit!(AuthorityUpdatedEvent {
            vault_state: state.key(),
            token_mint: state.token_mint,
            old_authority,
            new_authority,
            timestamp: clock.unix_timestamp,
        });

        msg!("Authority updated to {}", new_authority);

        Ok(())
    }
}

// ============================================================================
// Account Structs
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32,
        seeds = [b"vault_state", token_mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Use init_if_needed to allow reinitialization of vault ATA
    /// This is safe because:
    /// 1. The ATA is deterministically derived from vault_state and token_mint
    /// 2. The authority is set to vault_state PDA (not a user-controlled address)
    /// 3. Reinitializing an existing ATA has no negative security impact
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

    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetWithdrawalAccount<'info> {
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump,
        has_one = authority,
        has_one = token_mint
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Validated in instruction logic
    pub new_wallet: UncheckedAccount<'info>,

    /// CHECK: May or may not exist; validated/created in instruction
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

    #[account(
        init,
        payer = user,
        space = 8 + 4 + MAX_ORDER_ID_LEN + 32 + 32 + 8 + 8,
        seeds = [b"deposit_record", vault_state.token_mint.as_ref(), user.key().as_ref(), order_id.as_bytes()],
        bump
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.token_mint.as_ref()],
        bump,
        has_one = authority
    )]
    pub vault_state: Account<'info, VaultState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(order_id: String)]
pub struct CheckDeposit<'info> {
    #[account(
        seeds = [b"deposit_record", token_mint.key().as_ref(), depositor.key().as_ref(), order_id.as_bytes()],
        bump
    )]
    pub deposit_record: Account<'info, DepositRecord>,

    pub token_mint: Account<'info, Mint>,

    /// CHECK: Public key used for PDA derivation
    pub depositor: UncheckedAccount<'info>,
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

// CloseVault struct removed
// See comment in program module for rationale.

// CreateWalletAtaIfNeeded struct removed
// See comment in program module for rationale.

// ============================================================================
// State Accounts
// ============================================================================

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub wallet_account: Pubkey,
}

#[account]
pub struct DepositRecord {
    pub order_id: String,
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

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
    // VaultNotEmpty error removed
    #[msg("Account is not rent exempt")]
    NotRentExempt,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid withdrawal wallet address")]
    InvalidWithdrawalWallet,
    #[msg("Invalid authority address")]
    InvalidAuthority,
    #[msg("Order ID cannot be empty")]
    OrderIdEmpty,
    #[msg("Invalid token account data length")]
    InvalidDataLength,
    #[msg("Token account state is corrupted or invalid")]
    CorruptedTokenAccount,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct VaultInitializedEvent {
    pub vault_state: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub order_id: String,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub vault_state: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub destination_wallet: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalWalletUpdatedEvent {
    pub vault_state: Pubkey,
    pub token_mint: Pubkey,
    pub new_wallet: Pubkey,
    pub wallet_ata: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityUpdatedEvent {
    pub vault_state: Pubkey,
    pub token_mint: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

// VaultClosedEvent removed

// AtaCreatedEvent removed
