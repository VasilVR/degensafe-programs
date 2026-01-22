# Stake Program Tests

This directory contains comprehensive tests for the Stake Program, organized by functional area for better maintainability and clarity.

## Test Files

### 🛠️ `test-utils.ts`
Shared utilities and helper functions used across all test files:
- `warpSeconds()`: Advances blockchain time for testing time-dependent features
- `getTestEnvironment()`: Initializes and returns the test environment (provider, program, admin)

### 🪙 `pool-creation.test.ts`
Tests for pool creation and initialization:
- Creating pools with token mint and reward mint
- Verifying reward vault PDA creation
- Handling duplicate pool creation attempts
- Testing reward percentage validation (0%, high percentages, over limit)
- Fetching pool information

### 🔧 `pool-configuration.test.ts`
Tests for pool configuration and management:
- Updating reward percentages
- Authorization checks (only owner can update)
- Testing percentage limits and boundaries
- Verifying pool state after failed updates

### 🏦 `reward-vault.test.ts`
Tests for reward vault management:
- Admin depositing rewards into vault
- Admin withdrawing rewards from vault
- Updating pool reward mint and vault
- Tracking multiple reward vaults
- Authorization checks for vault operations

### 🧑‍💼 `user-staking.test.ts`
Tests for user staking operations:
- Users depositing stake
- Multiple deposits to same stake account
- Tracking stake amounts and balances
- Pool state updates on user deposits

### 💸 `user-withdrawal.test.ts`
Tests for user withdrawal and claiming:
- Partial withdrawals
- Full withdrawals
- Reward claiming with time progression
- Pending rewards tracking
- Zero stake reward calculations

### 🧪 `edge-cases.test.ts`
Tests for edge cases and error scenarios:
- Attempting operations on disabled pools
- Admin draining reward vault (unclaimed rewards protection)
- Users withdrawing when vault is empty
- Refilling vault and claiming unclaimed rewards

### 🔒 `security.test.ts`
Tests for security and access control:
- Verifying only stake account owners can withdraw their stakes
- Testing unauthorized withdrawal attempts are properly blocked
- Confirming users can withdraw from their own stake accounts
- Validating the owner constraint prevents privilege escalation

## Running Tests

Tests can be run using the Anchor test command:

```bash
anchor test
```

Or using the package.json script:

```bash
npm test
# or
bun test
```

## Test Organization Benefits

1. **Better Maintainability**: Each file focuses on a specific aspect of the system
2. **Easier Debugging**: Failures are easier to trace to specific functionality
3. **Parallel Development**: Multiple developers can work on different test files
4. **Clear Documentation**: Test file names clearly indicate what's being tested
5. **Faster Iterations**: Can run specific test suites when working on particular features

## Adding New Tests

When adding new tests:
1. Identify which test file best matches the functionality being tested
2. Use the shared utilities from `test-utils.ts` where appropriate
3. Follow the existing naming conventions and structure
4. Ensure tests are independent and can run in any order
5. Add appropriate console logging for debugging
