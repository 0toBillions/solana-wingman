# Native Solana Programs (Without Anchor)

## TLDR

Native Solana programs are written in pure Rust using the `solana-program` crate with no framework overhead. You define an `entrypoint!` macro pointing to a `process_instruction` function that receives the `program_id`, a slice of `AccountInfo`, and raw `instruction_data` bytes. You manually parse accounts, deserialize instruction data (typically via Borsh), validate signers/owners/writability, and execute CPIs with `invoke` or `invoke_signed`. Native programs produce smaller binaries, give full control over compute, and are essential to understand even if you primarily use Anchor.

---

## Why Write Native Programs

| Reason | Detail |
|--------|--------|
| **Smaller binary** | No Anchor IDL or macro-generated code. Final `.so` can be 50-80% smaller. |
| **No framework overhead** | Zero hidden compute cost from Anchor account deserialization and constraint checks. |
| **Full control** | You decide exactly what gets validated and when. No magic behind the scenes. |
| **Deeper understanding** | Knowing the raw layer makes you a better Anchor developer too. |
| **Audit-friendly** | Some auditors prefer native because every line of logic is explicit. |

Native is a good choice for performance-critical programs, small utility programs, or when you need to squeeze every compute unit.

---

## The Entrypoint

Every Solana program has a single entrypoint. The `solana-program` crate provides the `entrypoint!` macro:

```rust
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // All program logic starts here
    Ok(())
}
```

**Key points:**
- `program_id` is the public key of the deployed program (your program's address).
- `accounts` is every account passed by the client in the transaction instruction.
- `instruction_data` is the raw byte payload the client sends (your custom encoding).
- Return `ProgramResult` which is `Result<(), ProgramError>`.

---

## Account Parsing

The runtime gives you a flat `&[AccountInfo]` slice. You parse it positionally using an iterator:

```rust
use solana_program::account_info::next_account_info;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let payer = next_account_info(accounts_iter)?;
    let counter_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    // Validate accounts...

    Ok(())
}
```

`next_account_info` returns `Result<&AccountInfo, ProgramError>` and advances the iterator. If the client didn't pass enough accounts, it returns `ProgramError::NotEnoughAccountKeys`.

### Validating Accounts

You must manually check everything Anchor would check for you:

```rust
// Check signer
if !payer.is_signer {
    return Err(ProgramError::MissingRequiredSignature);
}

// Check writable
if !counter_account.is_writable {
    return Err(ProgramError::InvalidAccountData);
}

// Check owner (account belongs to your program)
if counter_account.owner != program_id {
    return Err(ProgramError::IncorrectProgramId);
}

// Check specific key (e.g., system program)
if system_program.key != &solana_program::system_program::ID {
    return Err(ProgramError::IncorrectProgramId);
}

// Check account is not already initialized (data length check)
if counter_account.data_len() != 0 {
    return Err(ProgramError::AccountAlreadyInitialized);
}
```

### AccountInfo Fields

| Field | Type | Description |
|-------|------|-------------|
| `key` | `&Pubkey` | The account's public key |
| `is_signer` | `bool` | Whether this account signed the transaction |
| `is_writable` | `bool` | Whether the runtime allows writes |
| `lamports` | `Rc<RefCell<&mut u64>>` | Balance in lamports |
| `data` | `Rc<RefCell<&mut [u8]>>` | Raw account data bytes |
| `owner` | `&Pubkey` | Program that owns the account |
| `executable` | `bool` | Whether the account is an executable program |
| `rent_epoch` | `u64` | Next epoch rent is due (largely deprecated since rent exemption) |

---

## Instruction Data Deserialization

The client sends raw bytes. You define your instruction format and deserialize. Borsh is the standard:

```rust
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum CounterInstruction {
    Initialize,
    Increment { amount: u64 },
    Decrement { amount: u64 },
}
```

Then in your processor:

```rust
let instruction = CounterInstruction::try_from_slice(instruction_data)
    .map_err(|_| ProgramError::InvalidInstructionData)?;

match instruction {
    CounterInstruction::Initialize => {
        process_initialize(program_id, accounts)?;
    }
    CounterInstruction::Increment { amount } => {
        process_increment(program_id, accounts, amount)?;
    }
    CounterInstruction::Decrement { amount } => {
        process_decrement(program_id, accounts, amount)?;
    }
}
```

### Manual Tag-Based Parsing (Alternative)

Some programs skip Borsh enums and use a leading byte tag:

```rust
let (tag, rest) = instruction_data
    .split_first()
    .ok_or(ProgramError::InvalidInstructionData)?;

match tag {
    0 => process_initialize(program_id, accounts),
    1 => {
        let amount = u64::try_from_slice(rest)
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        process_increment(program_id, accounts, amount)
    }
    _ => Err(ProgramError::InvalidInstructionData),
}
```

---

## Program State: Account Structs and Space

Define your on-chain data structures with Borsh:

```rust
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CounterState {
    pub is_initialized: bool,   // 1 byte
    pub authority: Pubkey,      // 32 bytes
    pub count: u64,             // 8 bytes
}
```

### Space Calculation

You must calculate exact space for `create_account`:

```rust
impl CounterState {
    pub const LEN: usize = 1    // is_initialized (bool)
        + 32                     // authority (Pubkey)
        + 8;                     // count (u64)
}
```

Common sizes:
| Type | Size (bytes) |
|------|-------------|
| `bool` | 1 |
| `u8` / `i8` | 1 |
| `u16` / `i16` | 2 |
| `u32` / `i32` | 4 |
| `u64` / `i64` | 8 |
| `u128` / `i128` | 16 |
| `Pubkey` | 32 |
| `String` | 4 + len |
| `Vec<T>` | 4 + (len * size_of::<T>()) |
| `Option<T>` | 1 + size_of::<T>() |

### Discriminators

Anchor uses an 8-byte discriminator (SHA256 hash prefix). In native, you can add your own:

```rust
#[derive(BorshSerialize, BorshDeserialize)]
pub struct CounterState {
    pub discriminator: [u8; 8],
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub count: u64,
}

impl CounterState {
    // First 8 bytes of SHA256("account:CounterState") or any scheme you prefer
    pub const DISCRIMINATOR: [u8; 8] = [0xAC, 0xC0, 0x10, 0x5D, 0x3E, 0x7F, 0x21, 0x9A];
    pub const LEN: usize = 8 + 1 + 32 + 8; // 49 bytes
}
```

Validate on read:

```rust
let data = counter_account.try_borrow_data()?;
if data[..8] != CounterState::DISCRIMINATOR {
    return Err(ProgramError::InvalidAccountData);
}
let state = CounterState::try_from_slice(&data)?;
```

---

## Creating Accounts via System Program CPI

To create a new account owned by your program:

```rust
use solana_program::{
    program::invoke,
    system_instruction,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let counter_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let rent = Rent::get()?;
    let space = CounterState::LEN;
    let lamports = rent.minimum_balance(space);

    invoke(
        &system_instruction::create_account(
            payer.key,
            counter_account.key,
            lamports,
            space as u64,
            program_id, // owner = your program
        ),
        &[
            payer.clone(),
            counter_account.clone(),
            system_program.clone(),
        ],
    )?;

    // Initialize state
    let state = CounterState {
        is_initialized: true,
        authority: *payer.key,
        count: 0,
    };
    state.serialize(&mut *counter_account.try_borrow_mut_data()?)?;

    Ok(())
}
```

Note: `counter_account` must be a signer in this case (keypair generated client-side).

---

## PDA Derivation and invoke_signed

To create PDA-owned accounts, use `invoke_signed` instead of `invoke`:

```rust
fn process_initialize_pda(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let counter_pda = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA and verify
    let (expected_pda, bump) = Pubkey::find_program_address(
        &[b"counter", payer.key.as_ref()],
        program_id,
    );

    if counter_pda.key != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::get()?;
    let space = CounterState::LEN;
    let lamports = rent.minimum_balance(space);

    // The seeds used for signing — must include the bump
    let signer_seeds: &[&[u8]] = &[
        b"counter",
        payer.key.as_ref(),
        &[bump],
    ];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            counter_pda.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            payer.clone(),
            counter_pda.clone(),
            system_program.clone(),
        ],
        &[signer_seeds], // slice of signer seed slices
    )?;

    let state = CounterState {
        is_initialized: true,
        authority: *payer.key,
        count: 0,
    };
    state.serialize(&mut *counter_pda.try_borrow_mut_data()?)?;

    Ok(())
}
```

**Important:** The bump seed is critical. Always pass the canonical bump from `find_program_address`. You can also store the bump in account data to avoid recomputing it.

---

## Error Handling

### Using ProgramError

`solana_program` provides built-in errors:

```rust
use solana_program::program_error::ProgramError;

// Common variants:
// ProgramError::InvalidAccountData
// ProgramError::InvalidInstructionData
// ProgramError::MissingRequiredSignature
// ProgramError::IncorrectProgramId
// ProgramError::NotEnoughAccountKeys
// ProgramError::AccountAlreadyInitialized
// ProgramError::InvalidSeeds
// ProgramError::Custom(u32)
```

### Custom Error Enums

Define your own errors using `thiserror` and the `DecodeError` trait:

```rust
use solana_program::program_error::ProgramError;
use thiserror::Error;
use solana_program::decode_error::DecodeError;

#[derive(Error, Debug, Clone)]
pub enum CounterError {
    #[error("Account is not initialized")]
    NotInitialized,

    #[error("Account is already initialized")]
    AlreadyInitialized,

    #[error("Authority mismatch")]
    AuthorityMismatch,

    #[error("Counter overflow")]
    Overflow,

    #[error("Counter underflow")]
    Underflow,
}

impl From<CounterError> for ProgramError {
    fn from(e: CounterError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl<T> DecodeError<T> for CounterError {
    fn type_of() -> &'static str {
        "CounterError"
    }
}
```

Usage:

```rust
if !state.is_initialized {
    return Err(CounterError::NotInitialized.into());
}

let new_count = state.count
    .checked_add(amount)
    .ok_or(CounterError::Overflow)?;
```

---

## Full Working Example: Native Counter Program

### Cargo.toml

```toml
[package]
name = "native-counter"
version = "0.1.0"
edition = "2021"

[dependencies]
solana-program = "1.18"
borsh = "0.10"
thiserror = "1.0"

[lib]
crate-type = ["cdylib", "lib"]
```

### src/lib.rs

```rust
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};

// ── Entrypoint ──────────────────────────────────────────────

entrypoint!(process_instruction);

// ── State ───────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CounterState {
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub count: u64,
}

impl CounterState {
    pub const LEN: usize = 1 + 32 + 8; // 41 bytes
}

// ── Instructions ────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum CounterInstruction {
    /// Initialize a new counter PDA.
    /// Accounts: [signer payer, writable counter_pda, system_program]
    Initialize,

    /// Increment the counter.
    /// Accounts: [signer authority, writable counter_pda]
    Increment { amount: u64 },
}

// ── Processor ───────────────────────────────────────────────

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = CounterInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        CounterInstruction::Initialize => {
            msg!("Instruction: Initialize");
            process_initialize(program_id, accounts)
        }
        CounterInstruction::Increment { amount } => {
            msg!("Instruction: Increment by {}", amount);
            process_increment(program_id, accounts, amount)
        }
    }
}

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let counter_pda = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    // Validate payer is signer
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA
    let (expected_pda, bump) = Pubkey::find_program_address(
        &[b"counter", payer.key.as_ref()],
        program_id,
    );
    if counter_pda.key != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Ensure not already initialized
    if counter_pda.data_len() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // Create the account
    let rent = Rent::get()?;
    let space = CounterState::LEN;
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            counter_pda.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), counter_pda.clone(), system_program.clone()],
        &[&[b"counter", payer.key.as_ref(), &[bump]]],
    )?;

    // Write initial state
    let state = CounterState {
        is_initialized: true,
        authority: *payer.key,
        count: 0,
    };
    state.serialize(&mut *counter_pda.try_borrow_mut_data()?)?;

    msg!("Counter initialized for authority: {}", payer.key);
    Ok(())
}

fn process_increment(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let authority = next_account_info(accounts_iter)?;
    let counter_pda = next_account_info(accounts_iter)?;

    // Validate
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if counter_pda.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Deserialize
    let mut state = CounterState::try_from_slice(&counter_pda.try_borrow_data()?)?;
    if !state.is_initialized {
        return Err(ProgramError::UninitializedAccount);
    }
    if state.authority != *authority.key {
        return Err(ProgramError::InvalidAccountData);
    }

    // Update
    state.count = state.count
        .checked_add(amount)
        .ok_or(ProgramError::InvalidArgument)?;

    // Write back
    state.serialize(&mut *counter_pda.try_borrow_mut_data()?)?;

    msg!("Counter incremented to {}", state.count);
    Ok(())
}
```

### Client-Side (TypeScript)

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as borsh from "borsh";

const PROGRAM_ID = new PublicKey("YourProgramId...");

// Derive PDA
const [counterPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("counter"), payer.publicKey.toBuffer()],
  PROGRAM_ID
);

// Borsh-encode the Initialize instruction (enum index 0)
const initData = Buffer.from([0, 0, 0, 0]); // Borsh enum variant 0

const initIx = new TransactionInstruction({
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: counterPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: PROGRAM_ID,
  data: initData,
});

const tx = new Transaction().add(initIx);
await sendAndConfirmTransaction(connection, tx, [payer]);
```

---

## Native vs Anchor Comparison

| Aspect | Native | Anchor |
|--------|--------|--------|
| **Binary size** | Small (50-200 KB) | Larger (200-800 KB) |
| **Account parsing** | Manual iterator + validation | Declarative `#[derive(Accounts)]` |
| **Serialization** | Manual Borsh | Automatic via macros |
| **Error handling** | Manual `ProgramError` + custom enums | `#[error_code]` macro |
| **IDL generation** | None (manual) | Automatic |
| **Client SDK** | Manual instruction building | Auto-generated from IDL |
| **Compute cost** | Lower baseline | Slight overhead from checks |
| **Learning curve** | Steeper | Gentler |
| **Boilerplate** | High | Low |
| **Flexibility** | Maximum | Some constraints |

---

## When to Choose Native vs Anchor

**Choose Native when:**
- Building a very small utility program (e.g., a simple vault or escrow).
- Compute budget is critical and every CU matters.
- You want the smallest possible deployment size.
- You are building infrastructure that other programs depend on (SPL-style).
- The audit team prefers explicit, framework-free code.

**Choose Anchor when:**
- Building a complex application with many instructions and account types.
- You want auto-generated IDLs and TypeScript clients.
- Your team values development speed and maintainability.
- You want built-in security checks (signer, owner, discriminator) by default.
- You are prototyping or building in a hackathon.

**The best Solana developers know both.** Start with Anchor for productivity, learn native to understand what Anchor does under the hood, and reach for native when you need the extra control.
