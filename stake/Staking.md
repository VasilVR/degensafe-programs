# Staking Program Analysis

This document provides a detailed analysis of the staking smart contract (`stake/src/staking.rs`), intended for security auditors. It outlines the logic, functioning, and security reasoning for each instruction in the program.

## Program ID
`4qAXZhKVK5a8S98QoLHFoiMmFN7L1yi2TazC3yDaMVva`

## State Accounts

### Pool
Stores the global configuration and state of a staking pool.
- `token_mint`: The mint of the token being staked.
- `reward_mint`: The mint of the reward token.
- `reward_vault`: PDA holding the reward tokens.
- `owner`: The admin who can manage the pool.
- `total_staked`: Total amount of tokens currently staked in the pool.
- `reward_percentage`: Annual reward percentage (APY).
- `bump`: Bump seed for the pool PDA.
- `is_active`: Boolean flag to pause/unpause staking.

### UserStake
Stores the staking state for a specific user.
- `owner`: The user's wallet address.
- `pool`: The pool this stake belongs to.
- `amount`: Amount of tokens currently staked.
- `last_staked_time`: Timestamp of the last deposit or withdrawal.
- `total_earned`: Cumulative rewards earned (claimed + pending added to total).
- `unclaimed`: Pending rewards that haven't been withdrawn yet.
- `bump`: Bump seed for the user stake PDA.

---

## Instructions

### 1. `create_pool`
Initializes a new staking pool.

**Logic:**
- **Inputs:** `maybe_owner` (optional admin), `reward_percentage`.
- **State Initialization:**
    - Sets `pool.owner` to `maybe_owner` or defaults to the signer (`admin`).
    - Sets `token_mint` and `reward_mint` from the provided accounts.
    - Initializes `total_staked` to 0.
    - Sets `is_active` to `true`.
    - Stores the `reward_vault` key.

**Security Reasoning:**
- **Access Control:** None (anyone can create a pool), but the creator becomes the owner.
- **PDA Validation:** Uses `init_if_needed` with seeds `[b"staking_pool", token_mint.key().as_ref()]`. This ensures one pool per token mint.

### 2. `get_pool_info`
Returns the current state of the pool.

**Logic:**
- Reads the `Pool` account and returns a `PoolData` struct.

**Security Reasoning:**
- Read-only instruction, no state changes.

### 3. `set_staking_active`
Enables or disables staking operations (deposit/withdraw).

**Logic:**
- **Inputs:** `active` (bool).
- **Access Control:** Checks if `pool.owner == ctx.accounts.admin.key()`.
- **State Update:** Updates `pool.is_active`.

**Security Reasoning:**
- **Authorization:** Strictly restricted to the pool owner. Prevents unauthorized freezing or unfreezing of the pool.

### 4. `update_reward_mint`
Updates the reward token mint and vault.

**Logic:**
- **Access Control:** Checks if `pool.owner == ctx.accounts.admin.key()`.
- **State Update:** Updates `pool.reward_mint` and `pool.reward_vault`.

**Security Reasoning:**
- **Authorization:** Restricted to pool owner.
- **Risk:** Changing the reward mint while users have pending rewards could lead to calculation issues if the decimals differ, or inability to claim if the new vault is empty. This is a privileged operation that requires trust in the admin.

### 5. `update_reward_percentage`
Updates the APY.

**Logic:**
- **Inputs:** `new_percentage`.
- **Access Control:** Checks if `pool.owner == ctx.accounts.admin.key()`.
- **State Update:** Updates `pool.reward_percentage`.

**Security Reasoning:**
- **Authorization:** Restricted to pool owner.
- **Impact:** Affects future reward calculations. Does not retroactively change rewards for time elapsed before this update (since rewards are calculated based on `last_staked_time` and current rate at the time of interaction). *Note: The current implementation calculates rewards for the entire period since `last_staked_time` using the **current** `reward_percentage`. This means changing the percentage affects the pending rewards for the whole elapsed duration, not just from the update time forward.*

### 6. `deposit_reward`
Deposits reward tokens into the pool's reward vault.

**Logic:**
- **Access Control:** Checks if `pool.owner == ctx.accounts.admin.key()`.
- **Active Check:** Requires `pool.is_active` to be true.
- **Transfer:** Transfers tokens from `admin_reward_account` to `reward_vault` using CPI to Token Program.

**Security Reasoning:**
- **Authorization:** Restricted to pool owner.
- **Funds:** Ensures rewards are physically moved to the vault.

### 7. `withdraw_reward`
Withdraws reward tokens from the vault back to the admin.

**Logic:**
- **Access Control:** Checks if `pool.owner == ctx.accounts.admin.key()`.
- **Transfer:** Transfers tokens from `reward_vault` to `admin_reward_account`.
- **Signing:** Uses PDA seeds `[b"staking_pool", token_mint, bump]` to sign for the vault? **Correction:** The `reward_vault` authority is the `pool` PDA. The seeds used for signing are `[b"staking_pool", pool.token_mint, bump]`.

**Security Reasoning:**
- **Authorization:** Restricted to pool owner.
- **Rug Pull Risk:** Admin can withdraw all rewards, potentially leaving users unable to claim. This is a standard centralized staking risk.

### 8. `deposit_stake`
Allows a user to stake tokens.

**Logic:**
- **Active Check:** Requires `pool.is_active` to be true.
- **Transfer:** Transfers `amount` from `user_token_account` to `pool_vault`.
- **Reward Calculation:**
    - If `user_stake.amount > 0`, calculates pending rewards using `calculate_pending_reward`.
    - Adds pending rewards to `user_stake.unclaimed`.
- **State Update:**
    - Increases `user_stake.amount`.
    - Updates `user_stake.last_staked_time` to current timestamp.
    - Increases `pool.total_staked`.

**Security Reasoning:**
- **Accounting:** Correctly updates pending rewards *before* changing the stake amount, ensuring the user gets rewards for the previous balance.
- **Timestamp:** Updates `last_staked_time` to reset the reward window.

### 9. `get_user_stake_info` & `get_user_stake_with_reward`
Returns user's stake data. `with_reward` variant calculates and includes pending rewards dynamically.

**Logic:**
- Reads `UserStake` account.
- `with_reward` calls `calculate_pending_reward` to estimate current earnings.

**Security Reasoning:**
- Read-only.

### 10. `withdraw_stake`
Allows a user to withdraw staked tokens and claim rewards.

**Logic:**
- **Active Check:** Requires `pool.is_active` to be true.
- **Balance Check:** Ensures `user_stake.amount >= amount`.
- **Reward Calculation:**
    - Calculates pending rewards.
    - Total reward = pending + `user_stake.unclaimed`.
- **Vault Check:** Checks if `reward_vault` has enough tokens for the reward.
- **State Update:**
    - Updates `user_stake.total_earned`.
    - Decreases `user_stake.amount`.
    - Resets `user_stake.unclaimed` to 0.
    - Updates `user_stake.last_staked_time`.
    - Decreases `pool.total_staked`.
- **Transfers:**
    - Transfers `amount` (principal) from `pool_vault` to user.
    - Transfers `reward_to_send` from `reward_vault` to user (if > 0).

**Security Reasoning:**
- **Checks-Effects-Interactions:** Updates state before performing transfers (though Anchor handles this safely usually).
- **Solvency:** Checks if reward vault has funds. If not, the transaction fails (`InsufficientRewardVault`), preventing partial state updates.
- **Principal Safety:** Principal is returned from `pool_vault`, separate from rewards.

## Helper: `calculate_pending_reward`

**Logic:**
- Formula: `(amount * reward_percentage * elapsed_seconds) / (365 * 24 * 60 * 60 * 100)`
- Uses `u128` for intermediate calculations to prevent overflow.

**Security Reasoning:**
- **Precision:** Integer arithmetic always rounds down.
- **Overflow Protection:** Uses `checked_mul` and `checked_div`.
- **Time Source:** Uses `Clock::get()`, which is reliable on Solana.

## Key Security Considerations

1.  **Centralization Risk:** The `owner` has significant control (pause staking, change reward mint, withdraw rewards). Users must trust the owner.
2.  **Reward Calculation on Update:** Changing `reward_percentage` affects the *entire* elapsed period since the last user interaction. It does not checkpoint the accumulated rewards at the old rate. This allows the admin to retroactively change the reward rate for the current period.
3.  **Vault Solvency:** If the reward vault is empty, users cannot withdraw their stake because the `withdraw_stake` function attempts to pay rewards and fails if funds are insufficient. **Recommendation:** Consider allowing emergency withdrawal of principal without rewards if the reward vault is empty.
