# Critical Solana Security Gotchas — The Top 10

> **MEMORIZE THESE.** Every Solana audit starts here. Every exploit post-mortem ends here.

---

## TLDR

| #  | Gotcha                          | One-Liner                                                        |
|----|---------------------------------|------------------------------------------------------------------|
| 1  | Missing Signer Checks          | Anyone can call your instruction if you forget `is_signer`       |
| 2  | Account Ownership Validation   | Accounts can lie about who owns them — verify `owner` field      |
| 3  | PDA Bump Canonicalization       | Use only the canonical bump or someone can forge duplicate PDAs  |
| 4  | Integer Overflow/Underflow      | Unchecked math wraps around; use `checked_*` or Anchor math      |
| 5  | CPI Privilege Escalation        | Signed accounts passed through CPI can be abused by malicious programs |
| 6  | Reinitialization Attacks        | If you can re-init an account, you can overwrite it with attacker data |
| 7  | Type Cosplay (Account Confusion)| A vault account bytes can be deserialized as a config account    |
| 8  | Closing Accounts Improperly     | Zeroing lamports without clearing data lets accounts be reopened |
| 9  | Arbitrary CPI Targets           | If you don't check the program_id in CPI, attackers swap it out |
| 10 | Oracle Staleness/Manipulation   | Stale or manipulated price feeds cause catastrophic mispricing   |

**If your program touches money: every single one of these applies to you.**

---

## 1. Missing Signer Checks

### What It Is

Failing to verify that a specific account actually signed the transaction. Without this check, anyone can impersonate the authority and execute privileged operations.

### Why It's Dangerous

An attacker can pass in any public key as the "authority" account without actually holding the private key. If your program does not assert `account.is_signer`, the instruction executes as if the real authority called it. This means unauthorized fund transfers, config changes, or admin operations.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: No signer check on authority
pub fn withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;  // <-- NOT checked as signer
    let recipient = next_account_info(account_iter)?;

    let vault_data = Vault::unpack(&vault.data.borrow())?;

    // BUG: only checks the pubkey matches, not that they actually signed
    if vault_data.authority != *authority.key {
        return Err(ProgramError::InvalidAccountData);
    }

    // Transfers funds — anyone can trigger this by passing the right pubkey
    **vault.try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Explicit signer verification
pub fn withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;
    let recipient = next_account_info(account_iter)?;

    // CHECK 1: Authority must have signed this transaction
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let vault_data = Vault::unpack(&vault.data.borrow())?;

    // CHECK 2: Signer must match the stored authority
    if vault_data.authority != *authority.key {
        return Err(ProgramError::InvalidAccountData);
    }

    **vault.try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;

    Ok(())
}
```

### How Anchor Helps

Anchor's `Signer` type enforces signer checks at the framework level. If the account is not a signer, deserialization fails before your instruction logic even runs.

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,  // Anchor enforces is_signer automatically
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}
```

### Real-World Reference

Multiple early Solana programs were drained due to missing signer checks. The spl-governance program had a reported vulnerability of this class. The Wormhole bridge hack ($320M, Feb 2022) involved a related verification bypass.

---

## 2. Account Ownership Validation

### What It Is

Not verifying that an account is owned by the expected program. The Solana runtime lets any account be passed to any instruction — it is the program's job to check the `owner` field.

### Why It's Dangerous

An attacker can create a fake account with arbitrary data, owned by a different program (or the System Program), and pass it where your program expects a legitimate account. If you deserialize it without checking ownership, you are reading attacker-controlled data as trusted state.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: No ownership check
pub fn process_transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let token_account = next_account_info(account_iter)?;

    // BUG: Deserializes without verifying token_account.owner == spl_token::id()
    // Attacker can pass a fake account with crafted data
    let token_data = TokenAccount::unpack(&token_account.data.borrow())?;

    if token_data.amount >= 1000 {
        // Grant premium access based on token balance
        grant_access()?;
    }

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Verify account ownership before deserialization
pub fn process_transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let token_account = next_account_info(account_iter)?;

    // CHECK: Verify the account is actually owned by the Token Program
    if token_account.owner != &spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let token_data = TokenAccount::unpack(&token_account.data.borrow())?;

    if token_data.amount >= 1000 {
        grant_access()?;
    }

    Ok(())
}
```

### How Anchor Helps

Anchor's `Account<'info, T>` type automatically checks that the account's owner matches the program that defines `T`. The `Program<'info, T>` type validates program accounts similarly.

```rust
#[derive(Accounts)]
pub struct CheckBalance<'info> {
    // Anchor verifies this is owned by the Token Program automatically
    pub token_account: Account<'info, TokenAccount>,
    // Anchor verifies this is the actual Token Program
    pub token_program: Program<'info, Token>,
}
```

### Real-World Reference

The Wormhole exploit (Feb 2022) involved a spoofed `SignatureSet` account that was not properly ownership-checked, allowing the attacker to bypass guardian verification.

---

## 3. PDA Bump Canonicalization

### What It Is

When deriving Program Derived Addresses (PDAs), the `find_program_address` function returns the canonical (highest valid) bump seed. If your program accepts an arbitrary bump as input, multiple valid PDAs can exist for the same logical entity.

### Why It's Dangerous

An attacker who can choose a non-canonical bump may create a second PDA that passes seed validation but points to a different address. This can lead to duplicate accounts, bypassed uniqueness constraints, or state corruption. Up to 255 valid bumps may exist for a given seed set.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: Accepts user-supplied bump without validating it's canonical
pub fn create_user_profile(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    bump: u8,  // <-- User supplies this
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let profile_pda = next_account_info(account_iter)?;

    // BUG: Uses the user-supplied bump — could be any valid bump, not the canonical one
    let seeds = &[b"profile", user.key.as_ref(), &[bump]];
    let derived = Pubkey::create_program_address(seeds, program_id)?;

    if derived != *profile_pda.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Attacker can create multiple "profile" accounts with different bumps
    initialize_profile(profile_pda)?;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Always derive the canonical bump internally
pub fn create_user_profile(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let profile_pda = next_account_info(account_iter)?;

    // Derive the canonical bump — find_program_address always returns the highest valid bump
    let (expected_pda, canonical_bump) = Pubkey::find_program_address(
        &[b"profile", user.key.as_ref()],
        program_id,
    );

    if expected_pda != *profile_pda.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Store the canonical bump for future verification
    let mut profile_data = Profile::unpack_unchecked(&profile_pda.data.borrow())?;
    profile_data.bump = canonical_bump;
    Profile::pack(profile_data, &mut profile_pda.data.borrow_mut())?;

    Ok(())
}
```

### How Anchor Helps

Anchor's `#[account(seeds = [...], bump)]` constraint calls `find_program_address` under the hood and validates the canonical bump. You can also store and reuse the bump with `bump = profile.bump`.

```rust
#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + Profile::INIT_SPACE,
        seeds = [b"profile", user.key().as_ref()],
        bump,  // Anchor enforces the canonical bump
    )]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}
```

### Real-World Reference

Several DeFi protocols on Solana had bump seed vulnerabilities in early 2022 that could allow duplicate vault creation. Neodyme's blog posts documented this class of bugs extensively.

---

## 4. Integer Overflow/Underflow

### What It Is

Performing arithmetic operations (add, subtract, multiply) without overflow protection. In Rust release builds, integer overflow wraps around silently (e.g., `u64::MAX + 1 = 0`).

### Why It's Dangerous

An attacker can manipulate amounts so that arithmetic wraps. A subtraction underflow can turn a small balance into `u64::MAX`. A multiplication overflow can reduce a large payment to near-zero. This directly leads to stolen funds.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: Unchecked arithmetic in release mode
pub fn process_deposit(
    vault: &mut Vault,
    user: &mut UserAccount,
    deposit_amount: u64,
    fee_bps: u64,
) -> ProgramResult {
    // BUG: If fee_bps is crafted, fee_amount can overflow to 0
    let fee_amount = deposit_amount * fee_bps / 10_000;

    // BUG: If deposit_amount < fee_amount due to rounding, this underflows
    // wrapping to u64::MAX in release builds
    let net_amount = deposit_amount - fee_amount;

    // BUG: If vault.total_deposits is near u64::MAX, this wraps to a small number
    vault.total_deposits = vault.total_deposits + net_amount;
    user.balance = user.balance + net_amount;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: All math uses checked operations
pub fn process_deposit(
    vault: &mut Vault,
    user: &mut UserAccount,
    deposit_amount: u64,
    fee_bps: u64,
) -> ProgramResult {
    // checked_mul and checked_div return None on overflow
    let fee_amount = deposit_amount
        .checked_mul(fee_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let net_amount = deposit_amount
        .checked_sub(fee_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    vault.total_deposits = vault.total_deposits
        .checked_add(net_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    user.balance = user.balance
        .checked_add(net_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
```

### How Anchor Helps

Anchor itself does not auto-check math, but it provides the `require!` macro for assertions. Best practice is to always use `checked_*` methods. Some teams also use the `uint` crate or Anchor's `ErrorCode` for clean error handling.

```rust
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    vault.total_deposits = vault.total_deposits
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    require!(amount > 0, ErrorCode::ZeroDeposit);

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,
}
```

### Real-World Reference

Integer overflow was a factor in the Cashio hack (March 2022, ~$52M). The attacker exploited an incomplete collateral verification path that allowed minting infinite tokens due to arithmetic issues in validation logic.

---

## 5. CPI Privilege Escalation

### What It Is

When your program makes a Cross-Program Invocation (CPI), all signer privileges of the calling instruction are forwarded to the callee. If your program passes through accounts that are signers, the callee receives those signer privileges — even if that was not your intent.

### Why It's Dangerous

A malicious or compromised program invoked via CPI inherits the signer authority of accounts your program has already validated. An attacker can craft an instruction that causes your program to CPI into a malicious program, which then uses the forwarded signer privileges to drain funds or modify state.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: Blindly forwarding all accounts to an arbitrary CPI target
pub fn execute_strategy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;       // signer
    let vault = next_account_info(account_iter)?;            // vault PDA
    let strategy_program = next_account_info(account_iter)?; // <-- unchecked!
    let remaining = account_iter.collect::<Vec<_>>();

    // BUG: authority's signer privilege is forwarded to an unchecked program
    // Attacker sets strategy_program to their own program, which uses the
    // forwarded signer privilege to transfer funds from the vault
    invoke(
        &Instruction {
            program_id: *strategy_program.key,
            accounts: remaining.iter().map(|a| AccountMeta {
                pubkey: *a.key,
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            }).collect(),
            data: vec![],
        },
        &[authority.clone(), vault.clone()],  // signer privileges forwarded!
    )?;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Validate CPI target and minimize forwarded privileges
pub fn execute_strategy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let vault = next_account_info(account_iter)?;
    let strategy_program = next_account_info(account_iter)?;

    // CHECK 1: Only allow CPI to a known, trusted program
    let allowed_strategies = [known_strategy_a::id(), known_strategy_b::id()];
    if !allowed_strategies.contains(strategy_program.key) {
        return Err(ProgramError::IncorrectProgramId);
    }

    // CHECK 2: Use PDA signing instead of forwarding user signer privileges
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[b"vault", authority.key.as_ref()],
        program_id,
    );
    let vault_seeds = &[b"vault", authority.key.as_ref(), &[vault_bump]];

    // Only the PDA signs — authority's signer privilege is NOT forwarded
    invoke_signed(
        &strategy_instruction(vault_pda),
        &[vault.clone(), strategy_program.clone()],
        &[vault_seeds],
    )?;

    Ok(())
}
```

### How Anchor Helps

Anchor's CPI module generates type-safe CPI builders that enforce account types. Combined with `Program<'info, T>` constraints, the target program is validated at deserialization.

```rust
// Anchor CPI context — type-safe, program is validated
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),  // validated by Program<'info, Token>
    Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    },
);
token::transfer(cpi_ctx, amount)?;
```

### Real-World Reference

CPI privilege escalation was a contributing factor in the Wormhole exploit. The attacker's crafted instruction caused Wormhole to CPI into the system program, completing a spoofed verification.

---

## 6. Reinitialization Attacks

### What It Is

Allowing an account that has already been initialized to be initialized again. If the `init` logic does not check whether the account already holds valid data, an attacker can overwrite existing state.

### Why It's Dangerous

An attacker can call the initialization instruction on an already-active vault, pool, or config account, resetting its authority to the attacker's key, zeroing balances, or corrupting state. This is essentially a hostile takeover of existing accounts.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: No check for prior initialization
pub fn initialize_vault(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    // BUG: Overwrites whatever is already in the account
    // If vault was already initialized with real funds, attacker
    // re-initializes it with their own key as authority
    let mut vault_data = Vault {
        is_initialized: true,
        authority: *authority.key,
        balance: 0,
    };

    Vault::pack(vault_data, &mut vault.data.borrow_mut())?;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Check initialization flag before writing
pub fn initialize_vault(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    // CHECK: Reject if already initialized
    let existing_data = Vault::unpack_unchecked(&vault.data.borrow())?;
    if existing_data.is_initialized {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // Also verify ownership
    if vault.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let vault_data = Vault {
        is_initialized: true,
        authority: *authority.key,
        balance: 0,
    };

    Vault::pack(vault_data, &mut vault.data.borrow_mut())?;

    Ok(())
}
```

### How Anchor Helps

Anchor's `init` constraint handles this automatically. It uses `create_account` under the hood, which fails if the account already exists (has non-zero lamports and data). The account's discriminator (first 8 bytes) is also checked.

```rust
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,               // Fails if account already exists
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", payer.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}
```

### Real-World Reference

Reinitialization bugs have appeared in multiple Solana programs. The Jet Protocol disclosed a vulnerability where pool accounts could potentially be re-initialized, which was patched before exploitation.

---

## 7. Type Cosplay (Account Confusion)

### What It Is

Passing an account serialized as one type (e.g., `UserProfile`) into a field expecting a different type (e.g., `VaultConfig`). If both types share a similar byte layout, deserialization succeeds with corrupted or attacker-controlled values.

### Why It's Dangerous

An attacker creates a legitimate account of type A (which they control), then passes it where type B is expected. If the program does not distinguish between types, the attacker's data is interpreted as trusted configuration. This can change authorities, amounts, or access controls.

### Vulnerable Code (Native Rust)

```rust
// Two account types with similar layouts but different purposes
#[derive(BorshSerialize, BorshDeserialize)]
pub struct Vault {
    pub authority: Pubkey,
    pub balance: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UserStats {
    pub user: Pubkey,       // same offset as authority
    pub points: u64,        // same offset as balance
}

// VULNERABLE: No type discrimination
pub fn withdraw_from_vault(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault_info = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    // BUG: Deserializes raw bytes — a UserStats account can be passed here
    // The attacker's user pubkey is read as the vault's authority
    let vault: Vault = Vault::try_from_slice(&vault_info.data.borrow())?;

    if vault.authority != *authority.key {
        return Err(ProgramError::InvalidAccountData);
    }

    // Attacker passes their UserStats account (where user == attacker's key)
    // and is now treated as the vault authority
    process_withdrawal(vault_info, authority)?;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Add a type discriminator to every account type
#[derive(BorshSerialize, BorshDeserialize)]
pub struct Vault {
    pub discriminator: [u8; 8],  // unique per type
    pub authority: Pubkey,
    pub balance: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct UserStats {
    pub discriminator: [u8; 8],  // different unique value
    pub user: Pubkey,
    pub points: u64,
}

impl Vault {
    pub const DISCRIMINATOR: [u8; 8] = [0x56, 0x41, 0x55, 0x4C, 0x54, 0x00, 0x00, 0x00];
}

impl UserStats {
    pub const DISCRIMINATOR: [u8; 8] = [0x55, 0x53, 0x45, 0x52, 0x53, 0x54, 0x00, 0x00];
}

pub fn withdraw_from_vault(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let vault_info = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    let vault: Vault = Vault::try_from_slice(&vault_info.data.borrow())?;

    // CHECK: Verify the discriminator matches Vault, not some other type
    if vault.discriminator != Vault::DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }

    if vault.authority != *authority.key {
        return Err(ProgramError::InvalidAccountData);
    }

    process_withdrawal(vault_info, authority)?;

    Ok(())
}
```

### How Anchor Helps

Anchor automatically prepends an 8-byte discriminator (SHA256 hash of `"account:<TypeName>"`) to every account. On deserialization, Anchor verifies the discriminator matches. This makes type cosplay virtually impossible.

```rust
// Anchor handles discriminators automatically
#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub balance: u64,
}

#[account]
pub struct UserStats {
    pub user: Pubkey,
    pub points: u64,
}

// Anchor will reject a UserStats account passed as Account<'info, Vault>
// because the first 8 bytes (discriminator) will not match
```

### Real-World Reference

Type cosplay was documented by Neodyme as a systemic vulnerability across multiple Solana programs. It was a key finding in several security audit reports from OtterSec and Halborn in 2022.

---

## 8. Closing Accounts (Lamport Drain + Reopen)

### What It Is

Improperly closing an account by only draining its lamports without clearing its data. After lamports are zeroed, the runtime garbage-collects the account at the end of the transaction. But within the same transaction (or before garbage collection in some edge cases), the account data is still readable and the account can be "revived" by sending lamports back to it.

### Why It's Dangerous

An attacker can close an account (drain lamports), then within the same transaction, re-fund it. The account data is still intact because the runtime has not yet cleaned it up. The attacker now has a "zombie" account with stale data that the program believes was properly closed.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: Only drains lamports, does not clear data or mark as closed
pub fn close_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let account_to_close = next_account_info(account_iter)?;
    let recipient = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Transfer all lamports to recipient
    let lamports = account_to_close.lamports();
    **account_to_close.try_borrow_mut_lamports()? = 0;
    **recipient.try_borrow_mut_lamports()? += lamports;

    // BUG: Data is NOT zeroed out — account can be revived with stale data
    // Another instruction in the same tx can re-fund this account

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Zero data, set discriminator to closed, drain lamports
pub fn close_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let account_to_close = next_account_info(account_iter)?;
    let recipient = next_account_info(account_iter)?;
    let authority = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // STEP 1: Zero out ALL account data so it cannot be re-interpreted
    let data_len = account_to_close.data_len();
    let mut data = account_to_close.try_borrow_mut_data()?;
    // Overwrite with a "CLOSED" discriminator to prevent revival
    sol_memset(&mut data, 0, data_len);
    // Optionally: write a closed-account discriminator
    // data[0..8].copy_from_slice(&CLOSED_ACCOUNT_DISCRIMINATOR);

    // STEP 2: Transfer all lamports
    let lamports = account_to_close.lamports();
    **account_to_close.try_borrow_mut_lamports()? = 0;
    **recipient.try_borrow_mut_lamports()? += lamports;

    // STEP 3: Assign ownership back to system program (optional but recommended)
    account_to_close.assign(&solana_program::system_program::id());

    Ok(())
}
```

### How Anchor Helps

Anchor's `#[account(close = recipient)]` constraint handles everything: it zeroes the discriminator (sets it to `CLOSED_ACCOUNT_DISCRIMINATOR`), drains lamports to the recipient, and transfers ownership to the system program. Additionally, Anchor rejects accounts whose data starts with the closed-account discriminator.

```rust
#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        mut,
        close = recipient,  // Anchor handles zeroing, draining, and ownership transfer
        has_one = authority,
    )]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
    #[account(mut)]
    /// CHECK: Receives lamports from closed account
    pub recipient: UncheckedAccount<'info>,
}
```

### Real-World Reference

Account revival attacks were documented in Solana security advisories. The "close and reopen" pattern was a known vulnerability in several DEX programs, allowing attackers to manipulate order books or position data.

---

## 9. Arbitrary CPI Targets

### What It Is

Making a Cross-Program Invocation (CPI) to a program whose address is provided by the caller without validating it. The attacker substitutes a malicious program that mimics the expected interface.

### Why It's Dangerous

If your program CPIs into what it thinks is the SPL Token program but is actually an attacker-deployed contract, the attacker's program can return success without performing the actual operation (e.g., no tokens are actually transferred, but your program proceeds as if they were), or it can abuse forwarded signer privileges.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: CPI target is not validated
pub fn swap(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let user_token_a = next_account_info(account_iter)?;
    let pool_token_a = next_account_info(account_iter)?;
    let pool_token_b = next_account_info(account_iter)?;
    let user_token_b = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;  // <-- NOT validated

    // BUG: If token_program is a fake, this "transfer" does nothing
    // but our program thinks tokens were moved
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,      // attacker's program
            user_token_a.key,
            pool_token_a.key,
            user.key,
            &[],
            amount,
        )?,
        &[user_token_a.clone(), pool_token_a.clone(), user.clone(), token_program.clone()],
    )?;

    // Program now sends tokens to user assuming the inbound transfer happened
    send_tokens_to_user(pool_token_b, user_token_b, amount)?;

    Ok(())
}
```

### Secure Code (Native Rust)

```rust
// SECURE: Validate the CPI target program ID
pub fn swap(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?;
    let user_token_a = next_account_info(account_iter)?;
    let pool_token_a = next_account_info(account_iter)?;
    let pool_token_b = next_account_info(account_iter)?;
    let user_token_b = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    // CHECK: Verify this is actually the SPL Token Program
    if token_program.key != &spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            user_token_a.key,
            pool_token_a.key,
            user.key,
            &[],
            amount,
        )?,
        &[user_token_a.clone(), pool_token_a.clone(), user.clone(), token_program.clone()],
    )?;

    send_tokens_to_user(pool_token_b, user_token_b, amount)?;

    Ok(())
}
```

### How Anchor Helps

Anchor's `Program<'info, T>` type validates the program account's key matches the expected program ID. This makes fake program injection impossible.

```rust
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_token_b: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,
    // Anchor validates this IS the Token Program — no fake programs allowed
    pub token_program: Program<'info, Token>,
}
```

### Real-World Reference

Arbitrary CPI targets were a factor in the Saber protocol vulnerability (announced in 2022). Fake program injection is listed as a critical finding class in OtterSec, Neodyme, and Halborn audit taxonomies.

---

## 10. Oracle Staleness and Manipulation

### What It Is

Using price oracle data without verifying its freshness (timestamp) or without protecting against price manipulation through flash loans or thin-liquidity exploits.

### Why It's Dangerous

Stale prices can be wildly out of date, allowing arbitrage. Manipulated prices (via flash loans that temporarily move AMM prices) let attackers borrow at inflated collateral values or liquidate at incorrect prices. DeFi protocols have lost hundreds of millions to oracle attacks.

### Vulnerable Code (Native Rust)

```rust
// VULNERABLE: No staleness check, no sanity bounds
pub fn calculate_collateral_value(
    oracle_account: &AccountInfo,
    collateral_amount: u64,
) -> Result<u64, ProgramError> {
    // BUG 1: Not verifying oracle account ownership
    let price_feed = PriceFeed::deserialize(&oracle_account.data.borrow())?;

    // BUG 2: No check on price_feed.timestamp — could be hours or days old
    // BUG 3: No confidence interval check
    // BUG 4: No sanity bounds on the price (could be 0 or u64::MAX)
    let price = price_feed.price;

    let value = collateral_amount
        .checked_mul(price as u64)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(value)
}
```

### Secure Code (Native Rust)

```rust
use pyth_sdk_solana::state::SolanaPriceAccount;

// SECURE: Full oracle validation
pub fn calculate_collateral_value(
    oracle_account: &AccountInfo,
    collateral_amount: u64,
    clock: &Clock,
) -> Result<u64, ProgramError> {
    // CHECK 1: Verify the oracle account is owned by the Pyth program
    if oracle_account.owner != &pyth_oracle_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let price_account = SolanaPriceAccount::account_info_to_feed(oracle_account)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let current_price = price_account
        .get_price_no_older_than(clock.unix_timestamp, 60)  // CHECK 2: Max 60 seconds stale
        .ok_or(ProgramError::InvalidAccountData)?;

    // CHECK 3: Confidence interval must be within 2% of the price
    // Wide confidence means the price is uncertain/manipulable
    let confidence = current_price.conf;
    let price_abs = current_price.price.unsigned_abs();
    if confidence > price_abs / 50 {
        return Err(ProgramError::InvalidAccountData); // Price too uncertain
    }

    // CHECK 4: Sanity bounds — reject clearly wrong prices
    let price_u64 = u64::try_from(current_price.price)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if price_u64 == 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // CHECK 5: Use checked arithmetic for the final calculation
    let value = collateral_amount
        .checked_mul(price_u64)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(value)
}
```

### How Anchor Helps

Anchor does not directly handle oracle validation, but you can write custom constraints and use Pyth/Switchboard SDKs within Anchor programs.

```rust
#[derive(Accounts)]
pub struct LiquidityAction<'info> {
    #[account(
        constraint = price_oracle.owner == &pyth_oracle_program::ID
            @ ErrorCode::InvalidOracle
    )]
    /// CHECK: Validated by constraint and in instruction logic
    pub price_oracle: UncheckedAccount<'info>,
}

pub fn process_action(ctx: Context<LiquidityAction>) -> Result<()> {
    let clock = Clock::get()?;
    let oracle = &ctx.accounts.price_oracle;

    let price_feed = SolanaPriceAccount::account_info_to_feed(&oracle.to_account_info())
        .map_err(|_| error!(ErrorCode::InvalidOracle))?;

    let price = price_feed
        .get_price_no_older_than(clock.unix_timestamp, 30)
        .ok_or(ErrorCode::StalePriceFeed)?;

    require!(
        price.conf < price.price.unsigned_abs() / 50,
        ErrorCode::PriceTooUncertain
    );

    // proceed with validated price
    Ok(())
}
```

### Real-World Reference

- **Mango Markets** (Oct 2022, ~$115M): Attacker manipulated the MNGO-PERP oracle price by trading against thin liquidity, inflating their account value, then borrowing against it.
- **Solend** near-exploit (June 2022): A whale position threatened protocol solvency due to reliance on potentially manipulable on-chain oracle prices.
- Numerous DeFi exploits across chains (Euler, Cream, etc.) stem from oracle issues.

---

## Quick-Reference Security Checklist

Use this checklist for every instruction in every Solana program you write or audit.

### Account Validation

- [ ] **Every privileged operation checks `is_signer`** on the authority account
- [ ] **Every deserialized account's `owner` field** is verified against the expected program
- [ ] **Every PDA uses the canonical bump** from `find_program_address`, not a user-supplied bump
- [ ] **Every account has a type discriminator** to prevent type cosplay (Anchor does this automatically)
- [ ] **Accounts cannot be re-initialized** once already set up (check `is_initialized` flag or use Anchor `init`)

### Arithmetic

- [ ] **All math uses `checked_add`, `checked_sub`, `checked_mul`, `checked_div`** or equivalent
- [ ] **No implicit casts** between integer sizes without validation (e.g., `u128 as u64`)
- [ ] **Division-before-multiplication** ordering is avoided (causes precision loss)

### Cross-Program Invocations

- [ ] **Every CPI target program ID is validated** against a known constant (or use Anchor `Program<'info, T>`)
- [ ] **Signer privileges are not forwarded** to untrusted programs
- [ ] **PDA signing is preferred** over forwarding user signer accounts through CPI

### Account Lifecycle

- [ ] **Closed accounts have their data zeroed** before lamports are drained
- [ ] **Closed accounts are assigned back** to the system program (or use Anchor `close`)
- [ ] **Programs reject accounts** with the closed-account discriminator

### Oracles and External Data

- [ ] **Oracle account ownership** is verified (Pyth, Switchboard, etc.)
- [ ] **Price staleness** is checked — reject data older than N seconds
- [ ] **Confidence intervals** are checked — reject uncertain prices
- [ ] **Sanity bounds** are applied — reject zero, negative, or absurdly high prices
- [ ] **Multiple oracle sources** are considered for high-value operations

### General

- [ ] **All `UncheckedAccount` fields** in Anchor have a `/// CHECK:` comment explaining why
- [ ] **No `unsafe` blocks** unless absolutely necessary and thoroughly audited
- [ ] **Integration tests** cover adversarial inputs for every instruction
- [ ] **Fuzz testing** has been performed on critical instruction handlers
- [ ] **A third-party audit** has been completed before mainnet deployment

---

> **Remember:** Solana's programming model requires you to validate everything yourself.
> The runtime will happily pass any account to any program. It is YOUR program's
> responsibility to check every assumption. If you don't verify it, an attacker will exploit it.
