# Versioned Transactions, Address Lookup Tables, and Priority Fees

## TLDR

Solana v0 (versioned) transactions replace legacy transactions by adding support for Address Lookup Tables (ALTs), which compress on-chain account addresses from 32 bytes each down to 1-byte indices. This raises the practical limit from ~20 accounts to 64+ per transaction. Priority fees (via the Compute Budget program) let you tip validators with `SetComputeUnitPrice` to increase your transaction's scheduling priority. Together, versioned transactions + ALTs + priority fees are essential for production-grade Solana applications.

---

## Legacy vs Versioned Transactions

### Legacy Transactions

- Use a `Message` with a flat list of account public keys (32 bytes each).
- Hard limit: 1232 bytes per transaction.
- With signatures, headers, and instruction data, you typically max out at ~20-35 accounts.
- No address compression.

### Versioned Transactions (v0)

- Use a `MessageV0` that includes an `addressTableLookups` field.
- Account addresses referenced in an ALT are stored as 1-byte indices instead of 32-byte pubkeys.
- Same 1232-byte limit, but far more accounts fit.
- The version byte `0x80` (128) prefixed to the message signals v0 format.

```
Legacy:   [signatures] [message]
Versioned: [signatures] [0x80] [message_v0]
```

**All modern Solana applications should use versioned transactions.**

---

## Address Lookup Tables (ALTs)

### What They Are

An Address Lookup Table is an on-chain account (owned by the Address Lookup Table Program) that stores a list of up to 256 public keys. When building a v0 transaction, you reference the ALT and use 1-byte indices instead of 32-byte addresses.

### Why They Matter

| Scenario | Legacy | With ALT |
|----------|--------|----------|
| 30 accounts | 30 * 32 = 960 bytes | 32 (ALT address) + 30 * 1 = 62 bytes |
| 64 accounts | Impossible (exceeds limit) | 32 + 64 = 96 bytes |

ALTs save `31 bytes per account` (32 - 1), making complex DeFi transactions possible.

### ALT Rules

- ALTs must be created and populated **in a prior transaction** (or prior slot). They cannot be created and used in the same transaction.
- After extending an ALT, the new addresses become usable after the slot in which they were added is finalized (typically the next slot for `confirmed` commitment).
- ALTs can store up to 256 addresses.
- Only the ALT authority can extend or close it.
- Accounts that must sign the transaction cannot use ALT lookup (signers must be in the static account list).
- Writable and read-only lookups are tracked separately in `addressTableLookups`.

---

## Building a Versioned Transaction in TypeScript

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const payer = Keypair.generate();

// Your instruction(s)
const instruction = new TransactionInstruction({
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    // ... other accounts
  ],
  programId: new PublicKey("YourProgram..."),
  data: Buffer.from([/* instruction data */]),
});

// Fetch a recent blockhash
const { blockhash } = await connection.getLatestBlockhash();

// Optionally load ALTs
const lookupTableAddress = new PublicKey("YourALTAddress...");
const lookupTableAccount = await connection
  .getAddressLookupTable(lookupTableAddress)
  .then((res) => res.value);

// Build a v0 message
const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [instruction],
}).compileToV0Message(
  lookupTableAccount ? [lookupTableAccount] : [] // pass ALTs here
);

// Create and sign
const versionedTx = new VersionedTransaction(messageV0);
versionedTx.sign([payer]);

// Send
const txid = await connection.sendTransaction(versionedTx);
console.log("Sent versioned tx:", txid);
```

**Key difference from legacy:** Instead of `new Transaction().add(...)`, you use `TransactionMessage` + `compileToV0Message()` + `VersionedTransaction`.

---

## Compute Budget Program

The Compute Budget Program (`ComputeBudget111111111111111111111111111111`) allows you to:

1. **Set Compute Unit Limit** — override the default 200,000 CU limit per instruction.
2. **Set Compute Unit Price** — set a price per CU in micro-lamports (priority fee).

### SetComputeUnitLimit

```typescript
import { ComputeBudgetProgram } from "@solana/web3.js";

// Request 400,000 compute units for this transaction
const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 400_000,
});
```

- Default is 200,000 CU per instruction (max 1.4M per transaction).
- If your program needs more, set a higher limit.
- If your program uses less, set a lower limit to avoid overpaying priority fees (price is per CU).
- Setting the limit lower than actual usage causes the transaction to fail.

### SetComputeUnitPrice (Priority Fees)

```typescript
// Set price to 50,000 micro-lamports per CU
const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 50_000,
});
```

The total priority fee paid:
```
priority_fee = compute_unit_price * compute_unit_limit
```

Example: 50,000 micro-lamports/CU * 200,000 CU = 10,000,000,000 micro-lamports = 10,000 lamports = 0.00001 SOL.

---

## How Priority Fees Work

Solana validators use a scheduler that considers priority fees when ordering transactions within a block. Higher priority fee = more likely to be included quickly.

**Key points:**
- Priority fees go to the **block producer** (leader validator) as a tip. 50% is burned and 50% goes to the validator (as of SIMD-0096).
- Base fees (5,000 lamports per signature) are separate from priority fees.
- During congestion, transactions without priority fees may be dropped.
- Priority fee is per-transaction, not per-instruction.
- The fee is calculated as: `micro_lamports_per_cu * total_cu_limit`.

### Fee Hierarchy

```
Total transaction cost =
  base_fee (5,000 lamports * num_signatures)
  + priority_fee (micro_lamports_per_cu * cu_limit / 1_000_000)
```

---

## Getting Dynamic Priority Fees

Use `getRecentPrioritizationFees` to query recent fees paid on the network for relevant accounts:

```typescript
const recentFees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    // Add the writable accounts your transaction touches
  ],
});

// recentFees is an array of { slot, prioritizationFee } objects
// Take the median or a percentile for your bid
const fees = recentFees
  .map((f) => f.prioritizationFee)
  .filter((f) => f > 0)
  .sort((a, b) => a - b);

const medianFee = fees[Math.floor(fees.length / 2)] || 0;
console.log("Median recent priority fee:", medianFee, "micro-lamports/CU");
```

**Production strategy:**
- Query recent fees for the writable accounts your transaction touches.
- Use a percentile (e.g., 75th) rather than the maximum.
- Cap fees to avoid overpaying during fee spikes.
- Re-query and retry if your transaction is not confirmed within a timeout.

---

## Transaction Size Limits and How ALTs Help

The hard limit is **1232 bytes** per serialized transaction. This includes:

| Component | Size |
|-----------|------|
| Signature(s) | 64 bytes each |
| Message header | 3 bytes (num signers, read-only signed, read-only unsigned) |
| Account keys (legacy) | 32 bytes each |
| Recent blockhash | 32 bytes |
| Instructions | Variable (program index + account indices + data) |
| ALT lookups (v0) | 32 bytes per table + 1 byte per lookup |

**Example budget with 1 signer:**
```
1232 total
 - 64 (1 signature)
 - 3  (header)
 - 32 (blockhash)
 - ~50 (instruction overhead estimate)
 = 1083 bytes remaining for accounts + instruction data
```

Legacy: 1083 / 32 = ~33 accounts max (with no instruction data).
With ALT: Signer (32 bytes) + ALT ref (32 bytes) + 60 lookups (60 bytes) = 124 bytes for 61 accounts. Huge savings.

---

## Full TypeScript Examples

### Creating an Address Lookup Table

```typescript
import {
  Connection,
  Keypair,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const payer = Keypair.generate();

// Step 1: Get a recent slot for the ALT
const slot = await connection.getSlot();

// Step 2: Create the lookup table
const [createIx, lookupTableAddress] =
  AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

const { blockhash } = await connection.getLatestBlockhash();

const createMsg = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [createIx],
}).compileToV0Message();

const createTx = new VersionedTransaction(createMsg);
createTx.sign([payer]);

await connection.sendTransaction(createTx);
console.log("Lookup table created at:", lookupTableAddress.toBase58());
```

### Extending an ALT with Addresses

```typescript
// Add addresses to the lookup table
const addresses = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("11111111111111111111111111111111"),
  new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  // ... up to 256 total addresses across all extends
];

const extendIx = AddressLookupTableProgram.extendLookupTable({
  payer: payer.publicKey,
  authority: payer.publicKey,
  lookupTable: lookupTableAddress,
  addresses: addresses,
});

const { blockhash: bh2 } = await connection.getLatestBlockhash();

const extendMsg = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: bh2,
  instructions: [extendIx],
}).compileToV0Message();

const extendTx = new VersionedTransaction(extendMsg);
extendTx.sign([payer]);

await connection.sendTransaction(extendTx);
console.log("Lookup table extended with", addresses.length, "addresses");

// IMPORTANT: Wait for the extend transaction to be confirmed before using
// the ALT in a new transaction. The addresses are available in the next slot.
await connection.confirmTransaction(/* ... */);
```

### Sending a Versioned Transaction with Priority Fees

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";

async function sendWithPriorityFee(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  lookupTableAddress?: PublicKey
) {
  // 1. Set compute unit limit (tight estimate saves money)
  const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 200_000,
  });

  // 2. Get dynamic priority fee
  const writableAccounts = instructions
    .flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey));

  const recentFees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts.slice(0, 128), // API limit
  });

  const sortedFees = recentFees
    .map((f) => f.prioritizationFee)
    .filter((f) => f > 0)
    .sort((a, b) => a - b);

  // Use 75th percentile, floor at 1000, cap at 1_000_000
  const percentile75 = sortedFees[Math.floor(sortedFees.length * 0.75)] || 0;
  const priorityFee = Math.min(Math.max(percentile75, 1_000), 1_000_000);

  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee,
  });

  // 3. Build instructions array (compute budget FIRST)
  const allInstructions = [computeLimitIx, priorityFeeIx, ...instructions];

  // 4. Optionally load ALT
  let lookupTables: any[] = [];
  if (lookupTableAddress) {
    const result = await connection.getAddressLookupTable(lookupTableAddress);
    if (result.value) {
      lookupTables = [result.value];
    }
  }

  // 5. Build versioned transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(lookupTables);

  const versionedTx = new VersionedTransaction(messageV0);
  versionedTx.sign([payer]);

  // 6. Send with confirmation
  const txid = await connection.sendTransaction(versionedTx, {
    maxRetries: 3,
  });

  // 7. Confirm with timeout
  const confirmation = await connection.confirmTransaction(
    {
      signature: txid,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log(`Confirmed tx: ${txid} (priority fee: ${priorityFee} micro-lamports/CU)`);
  return txid;
}
```

---

## Compute Budget in Rust (On-Chain)

Programs can also read compute budget state on-chain, though most compute budget interactions are client-side. Here is how the instructions are structured:

```rust
// The ComputeBudget instructions are just specific byte layouts:
//
// SetComputeUnitLimit:
//   [0x02, units (u32 LE)]
//
// SetComputeUnitPrice:
//   [0x03, micro_lamports (u64 LE)]
//
// These are sent as instructions to ComputeBudget111111111111111111111111111111

use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

pub fn set_compute_unit_limit(units: u32) -> Instruction {
    let data = [&[0x02], &units.to_le_bytes()[..]].concat();
    Instruction {
        program_id: solana_program::compute_budget::id(),
        accounts: vec![],
        data,
    }
}

pub fn set_compute_unit_price(micro_lamports: u64) -> Instruction {
    let data = [&[0x03], &micro_lamports.to_le_bytes()[..]].concat();
    Instruction {
        program_id: solana_program::compute_budget::id(),
        accounts: vec![],
        data,
    }
}
```

---

## Getting Accurate Compute Unit Estimates

To set a tight CU limit (avoiding overpay on priority fees), simulate the transaction first:

```typescript
import { VersionedTransaction } from "@solana/web3.js";

async function getComputeUnitEstimate(
  connection: Connection,
  transaction: VersionedTransaction
): Promise<number> {
  const simulation = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  const unitsConsumed = simulation.value.unitsConsumed || 200_000;
  // Add 10-20% buffer
  return Math.ceil(unitsConsumed * 1.2);
}

// Usage: build tx with high CU limit first, simulate, then rebuild with tight limit
const estimatedCU = await getComputeUnitEstimate(connection, versionedTx);
// Now rebuild with ComputeBudgetProgram.setComputeUnitLimit({ units: estimatedCU })
```

---

## Best Practices for Production Transactions

### 1. Always Use Versioned Transactions
Legacy transactions still work but offer no advantages. Default to v0.

### 2. Pre-Create and Reuse ALTs
For programs with known account sets (e.g., a DEX with common token mints), create ALTs in advance and share them with users.

### 3. Set Tight Compute Limits
Simulate first, add a 10-20% buffer. Lower CU limit means lower total priority fee cost.

### 4. Use Dynamic Priority Fees
Query `getRecentPrioritizationFees` with your transaction's writable accounts. Use a percentile-based approach, not a fixed fee.

### 5. Implement Retry Logic with Blockhash Expiry
```typescript
async function sendWithRetry(
  connection: Connection,
  transaction: VersionedTransaction,
  signers: Keypair[],
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // Rebuild message with fresh blockhash
    // (re-sign after changing blockhash)
    transaction.message.recentBlockhash = blockhash;
    transaction.sign(signers);

    const txid = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 0, // we handle retries ourselves
    });

    const result = await connection.confirmTransaction(
      { signature: txid, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    if (!result.value.err) {
      return txid;
    }

    console.warn(`Attempt ${attempt + 1} failed, retrying...`);
  }

  throw new Error("Transaction failed after max retries");
}
```

### 6. Preflight vs Skip Preflight
- **Default (preflight on):** RPC simulates the transaction before forwarding to the leader. Catches obvious errors early.
- **Skip preflight:** Send directly to the leader. Faster but you lose early error detection. Use when speed is critical and you trust your transaction will succeed.

### 7. Handle ALT Deactivation
ALTs can be deactivated by their authority (a cooldown period applies). If you depend on someone else's ALT, be aware it could be deactivated. For critical applications, maintain your own ALTs.

### 8. Transaction Packing
If you have many operations, pack as many as possible into one transaction to save on base fees and reduce latency. ALTs make this feasible for account-heavy instructions.

### 9. Watch for Blockhash Expiry
Blockhashes are valid for ~60-90 seconds (~150 slots). If a transaction is not confirmed in that window, it is guaranteed to never land. Always use `lastValidBlockHeight` to know when to stop waiting and retry with a fresh blockhash.

### 10. Use Durable Nonces for Time-Insensitive Transactions
For transactions that do not need to land immediately (e.g., multisig approvals), use durable nonces instead of recent blockhashes. Durable nonces never expire until consumed.

```typescript
import { SystemProgram, NONCE_ACCOUNT_LENGTH, NonceAccount } from "@solana/web3.js";

// Create nonce account (one-time setup)
const nonceKeypair = Keypair.generate();
const createNonceIx = SystemProgram.createAccount({
  fromPubkey: payer.publicKey,
  newAccountPubkey: nonceKeypair.publicKey,
  lamports: await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH),
  space: NONCE_ACCOUNT_LENGTH,
  programId: SystemProgram.programId,
});
const initNonceIx = SystemProgram.nonceInitialize({
  noncePubkey: nonceKeypair.publicKey,
  authorizedPubkey: payer.publicKey,
});

// When building a tx with durable nonce:
// The FIRST instruction must be nonceAdvance
const advanceNonceIx = SystemProgram.nonceAdvance({
  noncePubkey: nonceKeypair.publicKey,
  authorizedPubkey: payer.publicKey,
});

// Use the nonce value as the "blockhash"
const nonceAccount = await connection.getAccountInfo(nonceKeypair.publicKey);
const nonce = NonceAccount.fromAccountData(nonceAccount!.data);

const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: nonce.nonce, // use nonce as blockhash
  instructions: [advanceNonceIx, /* your instructions */],
}).compileToV0Message();
```
