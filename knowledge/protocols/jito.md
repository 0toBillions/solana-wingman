# Jito

## TLDR

Jito is Solana's primary MEV infrastructure provider, offering bundle submission for transaction ordering guarantees, tip-based priority inclusion, and the jitoSOL liquid staking token. Jito's block engine allows searchers and applications to submit transaction bundles with tips that incentivize validators to include them in a specific order, enabling MEV extraction, arbitrage protection, and guaranteed execution. The protocol also operates Jito Restaking, which extends staked SOL security to additional network services through Vault Receipt Tokens (VRTs) and Node Consensus Network (NCN) operators.

## Overview

Jito's infrastructure consists of several interconnected components:

- **Jito Block Engine**: An off-chain system that receives transaction bundles from searchers, simulates them, and forwards profitable bundles to validators running the Jito-Solana client. Validators include these bundles in their blocks and receive tips.
- **Jito Bundles**: Atomic groups of up to 5 transactions that execute sequentially and all-or-nothing. If any transaction in the bundle fails, the entire bundle is dropped.
- **Tip Distribution**: Tips are SOL transfers to special tip accounts controlled by validators. The block engine ensures validators only include bundles where tips are paid.
- **jitoSOL (Liquid Staking)**: A stake pool token (SPL stake pool) that represents staked SOL earning MEV-enhanced yields. Validators in the Jito stake pool share MEV tips with stakers.
- **Jito Restaking**: A framework that lets jitoSOL and other assets be restaked to secure additional services (NCNs), similar to EigenLayer on Ethereum.

## Key Concepts

### MEV on Solana
Unlike Ethereum where MEV is extracted via block builder auctions, Solana's continuous block production model means MEV manifests as transaction ordering within a leader's slot. Jito's block engine provides an out-of-protocol mechanism for searchers to express ordering preferences via bundles and tips.

Common MEV strategies on Solana:
- **Arbitrage**: Exploiting price differences across DEXes.
- **Liquidations**: Executing DeFi liquidations before competitors.
- **Sandwich attacks**: Front-running and back-running user swaps (Jito disabled this feature in 2024 due to community backlash).
- **Backrunning**: Capturing arbitrage opportunities created by large trades.

### Bundle Mechanics
A bundle is an ordered list of 1-5 transactions submitted to the Jito block engine. Key properties:
- **Atomicity**: All transactions succeed or none execute.
- **Ordering**: Transactions execute in the exact order specified.
- **Tips**: At least one transaction must include a tip transfer to a Jito tip account.
- **Simulation**: The block engine simulates bundles before forwarding to validators.
- **Landing rate**: Not guaranteed; depends on validator slot, tip amount, and competition.

### Tip Accounts
Jito maintains 8 tip distribution accounts. Bundles must include a SOL transfer to one of these accounts. The tip incentivizes the validator to include the bundle. Tips are distributed: a portion to the validator and a portion to jitoSOL stakers (MEV rewards).

### jitoSOL Yield
jitoSOL earns yield from two sources:
1. **Staking rewards**: Standard Solana inflation rewards (~6-7% APY).
2. **MEV rewards**: Tips collected by Jito validators, distributed to the stake pool.

The combined yield makes jitoSOL one of the highest-yielding LSTs on Solana.

### Jito Restaking
Jito Restaking allows staked assets to secure additional services called Node Consensus Networks (NCNs). Key components:
- **Vault Receipt Tokens (VRTs)**: Tokenized positions representing restaked assets in a vault.
- **NCN Operators**: Node operators that run software for NCNs and are backed by restaked collateral.
- **Slashing**: Misbehavior by NCN operators can result in slashing of restaked assets.

## Architecture

### Program IDs

```
Jito Stake Pool:              Jito4APyf642JPZPx3hkNfR8ECSzuKEQMBe3HfwHjHP
Jito Tip Distribution:        4R3gSG8BpU4t19KYj8CfnBtxhxJnQ2EFpE4QsMdKEjwa
Jito Tip Payment (Progam):    T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt
Jito Restaking (Vault):       Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8
Jito Restaking (Core):        ResijkfDm1VDZzPAVRBYCRSJaEG3bz7nZpQBkxNWP1j
```

### Tip Accounts (Mainnet)

```
Tip Account 1:  96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
Tip Account 2:  HFqU5x63VTqvQss8hp11i4bPYoTGFjN9eYWHZtb7GaRz
Tip Account 3:  Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY
Tip Account 4:  ADaUMid9yfUytqMBgopwjb2DTLSf5iVX7dkPLeY6v7YJ
Tip Account 5:  DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh
Tip Account 6:  ADuUkR4vqLUMWXxW9gh6D6L8pMSgEPeNLe1oIAmxzBaQ
Tip Account 7:  DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL6SQN
Tip Account 8:  3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
```

### Key Accounts

- **Stake Pool Account**: The main jitoSOL stake pool state, holding pool configuration and total staked amount.
- **jitoSOL Mint**: `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` -- the SPL token mint for jitoSOL.
- **Tip Distribution Account**: Per-validator accounts that accumulate tips for distribution.

## Integration Guide

### Installation

```bash
npm install jito-ts @solana/web3.js @solana/spl-stake-pool bs58
```

### Submitting a Bundle

```typescript
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { SearcherClient, searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";

const BLOCK_ENGINE_URL = "https://mainnet.block-engine.jito.wtf";
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bPYoTGFjN9eYWHZtb7GaRz",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSf5iVX7dkPLeY6v7YJ",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSgEPeNLe1oIAmxzBaQ",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL6SQN",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

function getRandomTipAccount(): PublicKey {
  const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[index]);
}

async function submitBundle(
  connection: Connection,
  payer: Keypair,
  transactions: Transaction[],
  tipLamports: number = 10_000 // 0.00001 SOL tip
) {
  // Create the tip transaction
  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: getRandomTipAccount(),
      lamports: tipLamports,
    })
  );

  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // Set blockhash for all transactions
  const allTxs = [...transactions, tipTx];
  for (const tx of allTxs) {
    tx.recentBlockhash = recentBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
  }

  // Connect to the block engine
  const client = searcherClient(BLOCK_ENGINE_URL);

  // Create and send the bundle
  const bundle = new Bundle(allTxs, allTxs.length);
  const bundleId = await client.sendBundle(bundle);

  console.log("Bundle submitted:", bundleId);
  return bundleId;
}
```

### Sending a Transaction with Jito Tips (Simple)

```typescript
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

// Simple approach: add a tip instruction to your existing transaction
async function sendWithJitoTip(
  connection: Connection,
  payer: Keypair,
  transaction: Transaction,
  tipLamports: number = 10_000
) {
  // Append tip instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: getRandomTipAccount(),
      lamports: tipLamports,
    })
  );

  // Send via Jito RPC endpoint for bundle-like behavior
  const jitoConnection = new Connection(
    "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
    "confirmed"
  );

  const sig = await sendAndConfirmTransaction(jitoConnection, transaction, [payer]);
  console.log("Transaction landed with tip:", sig);
  return sig;
}
```

### Staking SOL for jitoSOL

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { depositSol } from "@solana/spl-stake-pool";

const JITO_STAKE_POOL = new PublicKey("Jito4APyf642JPZPx3hkNfR8ECSzuKEQMBe3HfwHjHP");
const JITOSOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");

async function stakeForJitoSol(
  connection: Connection,
  payer: Keypair,
  amountSol: number
) {
  const amountLamports = amountSol * 1e9;

  const depositTx = await depositSol(
    connection,
    JITO_STAKE_POOL,
    payer.publicKey, // from
    amountLamports,
    undefined, // referrer (optional)
  );

  // depositTx contains the instructions; sign and send
  for (const tx of depositTx.instructions ? [depositTx] : depositTx) {
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  }

  // Sign and send
  const sig = await connection.sendTransaction(depositTx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  console.log("Staked SOL for jitoSOL:", sig);
  return sig;
}
```

### Checking Bundle Status

```typescript
async function checkBundleStatus(bundleId: string) {
  const response = await fetch(
    "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
      }),
    }
  );

  const result = await response.json();
  const status = result.result?.value?.[0];

  if (!status) {
    console.log("Bundle not found (may still be processing)");
    return null;
  }

  console.log("Bundle status:", status.confirmation_status);
  console.log("Slot:", status.slot);
  console.log("Transactions:", status.transactions);
  return status;
}
```

## Common Patterns

### Arbitrage Bundle Pattern

```typescript
// Classic pattern: swap on DEX A, reverse swap on DEX B, tip from profit
async function arbBundle(
  connection: Connection,
  payer: Keypair,
  swapATx: Transaction,  // buy cheap on DEX A
  swapBTx: Transaction,  // sell expensive on DEX B
  tipLamports: number
) {
  // The tip transaction pays the validator from arb profits
  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: getRandomTipAccount(),
      lamports: tipLamports,
    })
  );

  // Bundle order matters: buy first, sell second, tip third
  return submitBundle(connection, payer, [swapATx, swapBTx], tipLamports);
}
```

### Tip Calculation

```typescript
// Dynamic tip calculation based on expected profit
function calculateTip(expectedProfitLamports: number): number {
  // Typical tip: 50-80% of profit for competitive MEV
  // For non-MEV priority: 10,000 - 100,000 lamports is usually sufficient
  const MIN_TIP = 10_000;       // 0.00001 SOL
  const MAX_TIP = 100_000_000;  // 0.1 SOL

  if (expectedProfitLamports <= 0) return MIN_TIP;

  const tip = Math.floor(expectedProfitLamports * 0.5);
  return Math.max(MIN_TIP, Math.min(tip, MAX_TIP));
}
```

### Monitoring Tip Account Balances

```typescript
async function monitorTips(connection: Connection) {
  for (const account of JITO_TIP_ACCOUNTS) {
    const balance = await connection.getBalance(new PublicKey(account));
    console.log(`${account}: ${balance / 1e9} SOL`);
  }
}
```

## Gotchas and Tips

1. **Bundle landing is not guaranteed**: Even with a high tip, your bundle may not land if the current leader is not running the Jito client, or if a competing bundle with a higher tip takes priority. Implement retry logic.

2. **Tip amount matters**: During high-MEV periods, tips can spike significantly. Monitor tip levels on https://explorer.jito.wtf to calibrate your tips. Too low and you will never land; too high and you lose profit.

3. **Bundle size limit**: Maximum 5 transactions per bundle, each within Solana's standard transaction size limit (1232 bytes). Use versioned transactions and address lookup tables for complex operations.

4. **All-or-nothing execution**: If any transaction in your bundle fails (e.g., slippage error, stale state), the entire bundle is dropped. Make sure each transaction has appropriate slippage tolerance and error handling.

5. **Block engine regions**: Jito operates block engines in multiple regions. Use the geographically closest endpoint for lowest latency:
   - `mainnet.block-engine.jito.wtf` (default)
   - `ny.mainnet.block-engine.jito.wtf` (New York)
   - `amsterdam.mainnet.block-engine.jito.wtf` (Amsterdam)
   - `tokyo.mainnet.block-engine.jito.wtf` (Tokyo)

6. **jitoSOL exchange rate**: jitoSOL appreciates against SOL over time as staking and MEV rewards accrue. The exchange rate is not 1:1. Always fetch the current pool state to calculate the correct conversion.

7. **Tip account rotation**: Always pick a random tip account from the list. Do not hardcode a single tip account, as the block engine expects tip distribution across all accounts.

8. **Restaking risk**: Jito Restaking introduces slashing risk. VRT holders are exposed to the slashing conditions of the NCNs their vault supports. Understand the risk profile before restaking.

9. **Sandwich protection removed**: Jito disabled mempool-based sandwich attack support in mid-2024 following community pressure. The block engine no longer facilitates front-running of user transactions.

## Resources

- Jito Labs: https://www.jito.wtf
- Jito Explorer: https://explorer.jito.wtf
- jito-ts SDK: https://github.com/jito-labs/jito-ts
- Jito Solana Client: https://github.com/jito-foundation/jito-solana
- Jito Restaking Docs: https://docs.jito.network/restaking
- jitoSOL Stake Pool: https://www.jito.network/staking
- Jito Block Engine API: https://jito-labs.gitbook.io/mev
- Jito Discord: https://discord.gg/jito
- SPL Stake Pool: https://spl.solana.com/stake-pool
