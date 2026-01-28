# Token Extensions (Token-2022)

## TLDR

Token-2022 (also called Token Extensions) is a superset of the original SPL Token program deployed at a different program ID (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). It supports all original SPL Token functionality plus a modular extension system that enables transfer fees, confidential transfers, transfer hooks, non-transferable (soulbound) tokens, on-chain metadata, and more. Extensions are configured at mint creation time and stored in the mint or token account data. New projects should strongly consider Token-2022 for any feature beyond basic fungible/NFT transfers.

---

## Token-2022 vs SPL Token

| | SPL Token | Token-2022 |
|--|-----------|------------|
| **Program ID** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| **Status** | Stable, widely adopted | Stable, growing adoption |
| **Extensions** | None | 15+ modular extensions |
| **Account size** | Fixed (Mint: 82 bytes, Token: 165 bytes) | Variable (base + extension data) |
| **Backward compatible** | N/A | Implements all SPL Token instructions |
| **Metadata** | Requires Metaplex (separate program) | Native metadata extension |

### Why a New Program?

The original SPL Token program has a fixed account layout. Adding features would break every existing token. Rather than a breaking upgrade, the Solana team created a new program that:
- Keeps full backward compatibility with SPL Token instruction layout.
- Adds a flexible extension system appended after the base account data.
- Uses a different program ID so both can coexist on-chain.

---

## Major Extensions

### Transfer Fees

Automatically deducts a fee on every transfer. The fee is held in the recipient's token account as "withheld" tokens that the fee authority can harvest.

- **Config:** `fee_basis_points` (u16, max 10000 = 100%) and `maximum_fee` (u64).
- **Two epochs:** Current and scheduled, allowing fee changes with a delay.
- Fee is calculated on the gross amount: `fee = amount * basis_points / 10000`, capped at `maximum_fee`.

### Confidential Transfers

Encrypts token balances and transfer amounts using ElGamal encryption and zero-knowledge proofs. Observers can see that a transfer happened but not the amount.

- Uses homomorphic encryption so the program can verify validity without decrypting.
- Requires client-side proof generation (computationally expensive).
- Auditor keys can optionally be configured for compliance.

### Transfer Hook

Calls a specified program on every transfer of the token. Enables custom logic like royalty enforcement, allow/deny lists, or analytics.

- The hook program must implement the Transfer Hook Interface.
- The mint stores the hook program ID.
- Extra accounts needed by the hook are stored in a validation account (PDA of the mint).

### Permanent Delegate

Grants a single authority permanent, irrevocable delegate power over all token accounts for that mint. The delegate can transfer or burn tokens from any holder.

- Use case: regulated assets where an issuer must be able to freeze/seize.
- Cannot be removed once set.

### Non-Transferable (Soulbound)

Tokens cannot be transferred between wallets. They can only be minted and burned.

- Use case: achievement badges, reputation tokens, identity credentials.
- Technically implemented by setting the mint's transfer logic to always reject.

### Interest-Bearing

Stores an interest rate on the mint. UI display amount grows over time based on the configured rate, but no actual tokens are minted. It is purely a display convention.

- The rate is stored as basis points with a timestamp.
- Clients use `amountToUiAmount` to calculate the display value.
- Useful for rebasing-style tokens.

### Default Account State

All new token accounts for this mint start in a specified state (e.g., `Frozen`).

- Use case: compliance tokens where accounts must be KYC-approved before use.
- The freeze authority must explicitly thaw accounts to allow transfers.

### CPI Guard

When enabled on a token account, blocks certain actions when called via CPI (Cross-Program Invocation). Only direct top-level instructions can:
- Transfer tokens
- Burn tokens
- Approve delegates
- Close the account

This prevents malicious programs from draining tokens when a user signs a transaction that CPIs into the token program.

### Immutable Owner

Prevents the owner of a token account from being changed. Associated Token Accounts (ATAs) always have this enabled by default in Token-2022.

### Memo Required on Transfer

Requires all incoming transfers to be preceded by a memo instruction (SPL Memo program). Useful for exchanges and compliance.

### Metadata and Metadata Pointer

Stores token metadata (name, symbol, URI, additional fields) directly in the mint account. No need for Metaplex.

- **Metadata Pointer:** Points to the account that holds metadata (can point to the mint itself).
- **Metadata:** The actual key-value data stored on-chain.

```
Metadata fields:
  - name: String
  - symbol: String
  - uri: String
  - additional_metadata: Vec<(String, String)>
```

### Group and Group Pointer

Enables hierarchical token grouping. A mint can be designated as a "group" that other mints (members) belong to.

- **Group Pointer:** Points to the account holding group configuration.
- **Group:** Stores max_size and current size.
- **Member Pointer:** On child mints, points to membership data.
- **Member:** Stores which group the mint belongs to and its member number.
- Use case: collections, structured product tranches.

---

## Creating a Mint with Extensions (Rust)

```rust
use spl_token_2022::{
    extension::{
        transfer_fee::TransferFeeConfig,
        metadata_pointer::MetadataPointer,
        ExtensionType,
    },
    instruction::{self as token_instruction},
    state::Mint,
};
use solana_program::{
    program::invoke,
    system_instruction,
    sysvar::rent::Rent,
};

// 1. Calculate space needed for mint + extensions
let extensions = &[
    ExtensionType::TransferFeeConfig,
    ExtensionType::MetadataPointer,
];
let space = ExtensionType::try_calculate_account_len::<Mint>(extensions)?;

// 2. Create the account with enough space
let rent = Rent::get()?;
let lamports = rent.minimum_balance(space);

invoke(
    &system_instruction::create_account(
        payer.key,
        mint.key,
        lamports,
        space as u64,
        &spl_token_2022::id(),
    ),
    &[payer.clone(), mint.clone()],
)?;

// 3. Initialize extensions BEFORE initializing the mint

// Initialize transfer fee
invoke(
    &spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config(
        &spl_token_2022::id(),
        mint.key,
        Some(&fee_authority.key),   // transfer fee config authority
        Some(&withdraw_authority.key), // withdraw withheld authority
        250,   // 2.5% fee (basis points)
        1_000_000, // maximum fee in token base units
    )?,
    &[mint.clone()],
)?;

// Initialize metadata pointer (pointing to mint itself)
invoke(
    &spl_token_2022::extension::metadata_pointer::instruction::initialize(
        &spl_token_2022::id(),
        mint.key,
        Some(*authority.key),
        Some(*mint.key), // metadata lives on the mint account
    )?,
    &[mint.clone()],
)?;

// 4. Initialize the mint last
invoke(
    &token_instruction::initialize_mint2(
        &spl_token_2022::id(),
        mint.key,
        mint_authority.key,
        Some(freeze_authority.key),
        6, // decimals
    )?,
    &[mint.clone()],
)?;
```

**Critical ordering:** Extensions must be initialized BEFORE `initialize_mint2`. The mint initialization locks the account layout.

---

## Creating a Mint with Extensions (TypeScript)

```typescript
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const payer = Keypair.generate();
const mintKeypair = Keypair.generate();
const mintAuthority = payer.publicKey;
const feeAuthority = payer.publicKey;
const withdrawAuthority = payer.publicKey;

// Calculate space for mint + TransferFeeConfig extension
const extensions = [ExtensionType.TransferFeeConfig];
const mintLen = getMintLen(extensions);
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

const transaction = new Transaction().add(
  // 1. Create account
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }),

  // 2. Initialize transfer fee extension (BEFORE mint init)
  createInitializeTransferFeeConfigInstruction(
    mintKeypair.publicKey,
    feeAuthority,
    withdrawAuthority,
    250,       // 2.5% fee basis points
    BigInt(1_000_000), // max fee
    TOKEN_2022_PROGRAM_ID
  ),

  // 3. Initialize mint (LAST)
  createInitializeMintInstruction(
    mintKeypair.publicKey,
    6,             // decimals
    mintAuthority,
    null,          // freeze authority
    TOKEN_2022_PROGRAM_ID
  )
);

await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);
console.log("Mint created:", mintKeypair.publicKey.toBase58());
```

---

## Transfer Fee Example: Collecting Withheld Fees

When transfers occur, fees are withheld in recipient token accounts. The withdraw authority can harvest them:

```typescript
import {
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
  getAccount,
  getTransferFeeAmount,
} from "@solana/spl-token";

// Step 1: Harvest withheld fees from token accounts into the mint
await harvestWithheldTokensToMint(
  connection,
  payer,
  mintKeypair.publicKey,
  TOKEN_2022_PROGRAM_ID
);

// Step 2: Withdraw accumulated fees from the mint to a destination
await withdrawWithheldTokensFromMint(
  connection,
  payer,
  mintKeypair.publicKey,
  destinationTokenAccount,
  withdrawAuthority,
  [],
  undefined,
  TOKEN_2022_PROGRAM_ID
);

// Check how much fee was withheld on a token account
const accountInfo = await getAccount(
  connection,
  recipientTokenAccount,
  "confirmed",
  TOKEN_2022_PROGRAM_ID
);
const feeAmount = getTransferFeeAmount(accountInfo);
console.log("Withheld:", feeAmount?.withheldAmount.toString());
```

---

## Transfer Hook Example

A transfer hook calls your custom program on every token transfer. Here is the setup:

### 1. Define the Hook Program (Rust/Anchor)

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("Hook1111111111111111111111111111111111111");

#[program]
pub mod transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        // Custom logic here: logging, allowlist checks, royalties, etc.
        msg!("Transfer hook fired! Amount: {}", amount);

        // Example: block transfers over a certain amount
        require!(amount <= 1_000_000_000, CustomError::TransferTooLarge);

        Ok(())
    }

    /// Called by Token-2022 to discover extra accounts needed by execute
    pub fn initialize_extra_account_metas(
        ctx: Context<InitializeExtraAccountMetas>,
    ) -> Result<()> {
        // Store any additional accounts the hook needs during execute
        // This is a PDA that Token-2022 reads to know what accounts to pass
        Ok(())
    }
}
```

### 2. Create a Mint with the Transfer Hook Extension

```typescript
import {
  createInitializeTransferHookInstruction,
} from "@solana/spl-token";

const transaction = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: getMintLen([ExtensionType.TransferHook]),
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }),
  createInitializeTransferHookInstruction(
    mintKeypair.publicKey,
    payer.publicKey,  // authority that can update the hook
    hookProgramId,    // your hook program
    TOKEN_2022_PROGRAM_ID
  ),
  createInitializeMintInstruction(
    mintKeypair.publicKey,
    6,
    mintAuthority,
    null,
    TOKEN_2022_PROGRAM_ID
  )
);
```

### 3. Initialize the Extra Account Metas

Before any transfers can occur, you must initialize the validation account (a PDA derived from `["extra-account-metas", mint]` under your hook program). Token-2022 reads this account to know which extra accounts to include when calling your hook.

---

## Confidential Transfers Overview

Confidential transfers use ElGamal encryption and zero-knowledge proofs to hide balances and transfer amounts on-chain.

**Flow:**
1. Mint authority enables the confidential transfer extension on the mint.
2. Token account owners configure their accounts for confidential transfers (providing their ElGamal public key).
3. To transfer, the sender:
   - Generates a zero-knowledge range proof (proving the amount is valid without revealing it).
   - Encrypts the amount under both sender and receiver ElGamal keys.
   - Submits the encrypted transfer instruction.
4. The program verifies the proof and updates encrypted balances.
5. Recipients must "apply" pending balances before they can use them.

**Limitations:**
- Proof generation is computationally expensive client-side.
- Transfer amounts are hidden but the fact that a transfer occurred is public.
- An optional auditor ElGamal key can decrypt amounts for compliance.

---

## Migration Considerations: SPL Token to Token-2022

### When to Migrate
- You need an extension that SPL Token does not support.
- You want on-chain metadata without Metaplex dependency.
- You are launching a new token and want future-proof features.

### Key Differences to Handle
- **Program ID changes everywhere:** Every instruction must target `TOKEN_2022_PROGRAM_ID`.
- **Associated Token Accounts:** ATAs are derived per-program. A Token-2022 ATA is different from an SPL Token ATA for the same mint/owner.
- **Account sizes vary:** `getMintLen(extensions)` instead of a fixed 82 bytes.
- **Extension initialization order:** Extensions must be initialized before the mint.
- **Ecosystem support:** Verify that DEXs, wallets, and tools support Token-2022 for your use case.

### Both Programs Coexist

You do not need to migrate existing SPL tokens. Token-2022 and SPL Token run side by side. New mints can use Token-2022 while old mints remain on SPL Token.

---

## Common Gotchas

1. **Extension order matters.** Always initialize extensions BEFORE calling `initializeMint`. If you initialize the mint first, the account layout is locked and extension initialization will fail.

2. **Account size calculation.** Use `getMintLen([...extensions])` (TypeScript) or `ExtensionType::try_calculate_account_len::<Mint>(&[...])` (Rust). Do not hardcode sizes.

3. **Different ATAs.** An ATA for Token-2022 and SPL Token for the same wallet and mint are at DIFFERENT addresses (different program ID in the derivation).

4. **CPI Guard blocks CPI transfers.** If a user enables CPI Guard, your program cannot transfer their tokens via CPI. Design around this or document the requirement.

5. **Transfer fees are gross, not net.** A transfer of 1000 tokens with 5% fee delivers 950 tokens. The sender still sends 1000. The 50 is withheld in the recipient's account.

6. **Harvesting fees is a two-step process.** First harvest from token accounts to the mint, then withdraw from the mint to a destination account.

7. **Confidential transfer proofs are large.** The proof data can be several hundred bytes, consuming significant transaction space. Consider versioned transactions with ALTs.

8. **Transfer hooks add accounts.** The hook's extra account metas PDA must be initialized and included in transfers. Libraries like `@solana/spl-token` handle this if you use the helper functions.

9. **Permanent delegate is permanent.** There is no instruction to remove it. Think carefully before enabling.

10. **Not all wallets support all extensions.** Test with your target wallets. Some may not display interest-bearing amounts correctly or may not handle transfer hooks gracefully.
