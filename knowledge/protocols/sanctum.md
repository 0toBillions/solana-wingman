# Sanctum

## TLDR

Sanctum is the LST (Liquid Staking Token) infrastructure layer on Solana, solving the fragmented liquidity problem where dozens of different liquid staking tokens each have thin markets and poor swap rates. Through the Infinity Pool (a unified multi-LST liquidity pool), Sanctum Router (instant LST-to-LST swaps), and a validator LST creation framework, Sanctum makes every LST deeply liquid and interchangeable. The protocol also introduced the S token for governance and incentive alignment across the LST ecosystem.

## Overview

Solana has a rich LST ecosystem with tokens like jitoSOL, mSOL, bSOL, and many validator-specific LSTs. The problem is that liquidity for each token is fragmented: swapping between LSTs or unstaking requires either waiting an epoch (~2-3 days) or routing through thin AMM pools with high slippage.

Sanctum solves this with three core components:

- **Sanctum Router**: Routes LST-to-LST swaps through an optimized path, often via the reserve pool or Infinity Pool, providing instant conversions at minimal slippage.
- **Infinity Pool (INF)**: A single liquidity pool that accepts all whitelisted LSTs. Depositing any LST into Infinity mints the INF token. The pool earns blended staking yield from all deposited LSTs, and its depth enables large LST swaps.
- **Validator LSTs**: Sanctum enables any Solana validator to create their own liquid staking token. Stakers receive a token representing their stake with that specific validator, but can still trade it instantly thanks to Sanctum's infrastructure.
- **Reserve Pool**: A pool of unstaked SOL that facilitates instant unstaking of LSTs. When a user wants to convert an LST to SOL instantly, the reserve pool provides SOL and takes the LST, later unstaking it through the normal epoch process.

## Key Concepts

### The LST Liquidity Problem
Each LST on Solana is a different SPL token. Without Sanctum, swapping mSOL for jitoSOL requires either:
1. Unstaking mSOL (wait 2-3 days for epoch boundary), then staking for jitoSOL.
2. Swapping through a DEX pool (high slippage for large amounts due to thin liquidity).

Sanctum eliminates both problems by providing deep pooled liquidity and instant routing.

### Infinity Pool Mechanics
The Infinity Pool is an SPL multi-token pool that accepts any whitelisted LST. The mechanics are:

1. **Deposit**: User deposits any LST (e.g., jitoSOL) into Infinity and receives INF tokens proportional to the SOL-value of the deposit.
2. **Withdrawal**: User redeems INF for any supported LST from the pool.
3. **Yield**: INF earns the weighted average staking yield of all LSTs in the pool. Since the pool holds diverse LSTs, yield is stable and diversified.
4. **Pricing**: Each LST's value is determined by its underlying stake account value (SOL per token), fetched from each respective stake pool program.

### Sanctum Router
The Router finds the optimal path for LST conversions. Possible routes include:
- Direct pool swaps (if a direct AMM pool exists with good liquidity).
- Via the Reserve Pool (LST -> SOL -> LST).
- Via Infinity Pool (LST -> INF -> LST).
- Multi-hop through intermediate LSTs.

The Router abstracts all of this behind a single API call.

### Validator LSTs
Any Solana validator can create a branded LST through Sanctum. The process:
1. Validator creates a single-validator stake pool (SPL Stake Pool with a whitelist of one validator).
2. Sanctum whitelists the LST in the Infinity Pool and Router.
3. Stakers deposit SOL and receive the validator's LST.
4. The LST is instantly liquid via Sanctum infrastructure.

This lets validators build communities around their token while stakers get the benefits of liquid staking.

### S Token and Governance
The S token is Sanctum's governance and incentive token. Key functions:
- Governance over protocol parameters (whitelisting, fees, Infinity Pool composition).
- Incentive alignment: validators and LST creators can earn S by bringing stake into the ecosystem.
- Potential fee accrual from Router and Infinity Pool operations.

## Architecture

### Program IDs

```
Sanctum Infinity Pool:    5ocnV1qiCgaQR8Jb8xWnVbApfaygJ1tNouo4MjXwak8
Sanctum Router (v1):      sRouteJmpWE5tRMmsh5fEjPqtEz9G7NRBGNfcMLapev
Sanctum Reserve Pool:     resv1DB8ZS7xKbdHsDWkKGE1VYqDywE2SVFKE1dMFcc
SPL Stake Pool Program:   SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy
SPL Single Validator:     SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE
```

### Key Accounts

- **Infinity Pool State**: Holds the list of accepted LSTs, their current balances, and pricing parameters.
- **INF Mint**: The SPL token mint for the Infinity Pool token (`5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm`).
- **Reserve Pool State**: Tracks the SOL reserve balance and pending unstake operations.
- **Router State**: Configuration for routing paths, fee parameters, and whitelisted LSTs.

### How Pricing Works

```
LST Value (in SOL) = Total SOL in Stake Pool / Total LST Supply

INF Value (in SOL) = Sum of (each LST balance * each LST's SOL value) / INF Supply
```

Each LST's SOL value is derived from its stake pool state, which tracks total active stake and total tokens minted.

### PDA Derivations

```typescript
import { PublicKey } from "@solana/web3.js";

const INFINITY_PROGRAM = new PublicKey("5ocnV1qiCgaQR8Jb8xWnVbApfaygJ1tNouo4MjXwak8");

// Infinity Pool PDA
const [infinityPoolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool")],
  INFINITY_PROGRAM
);

// LST reserve account within Infinity (per-LST)
const [lstReserve] = PublicKey.findProgramAddressSync(
  [Buffer.from("reserve"), lstMint.toBuffer()],
  INFINITY_PROGRAM
);
```

## Integration Guide

### Installation

```bash
npm install @solana/web3.js @sanctumso/sanctum-sdk
# or use the REST API directly
```

### Fetching LST Prices via API

```typescript
// Sanctum exposes a public API for LST pricing and routing

async function getLstPrices(): Promise<Record<string, number>> {
  const response = await fetch("https://sanctum-s-api.fly.dev/v1/sol-value/current", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const data = await response.json();
  // Returns: { "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": 1.0523, ... }
  // Each key is an LST mint, value is SOL per token
  return data.solValues;
}

async function getInfPrice(): Promise<number> {
  const prices = await getLstPrices();
  // INF mint
  const INF_MINT = "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm";
  return prices[INF_MINT] || 0;
}
```

### Getting a Swap Quote

```typescript
interface SwapQuote {
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feeMint: string;
  priceImpactPct: number;
  routePlan: Array<{
    pool: string;
    label: string;
  }>;
}

async function getSwapQuote(
  inputMint: string,  // LST mint address
  outputMint: string, // LST mint address
  amount: number      // in token base units (lamports for SOL)
): Promise<SwapQuote> {
  const params = new URLSearchParams({
    input: inputMint,
    outputLstMint: outputMint,
    amount: amount.toString(),
  });

  const response = await fetch(
    `https://sanctum-s-api.fly.dev/v1/swap/quote?${params}`,
    { headers: { "Content-Type": "application/json" } }
  );

  return response.json();
}

// Example: Quote swapping 10 jitoSOL to mSOL
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

const quote = await getSwapQuote(JITOSOL, MSOL, 10_000_000_000); // 10 tokens
console.log(`Output: ${Number(quote.outAmount) / 1e9} mSOL`);
console.log(`Price impact: ${quote.priceImpactPct}%`);
```

### Executing a Swap

```typescript
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

async function executeSwap(
  connection: Connection,
  payer: Keypair,
  inputMint: string,
  outputMint: string,
  amount: number,
  maxSlippageBps: number = 50 // 0.5%
) {
  // Step 1: Get quote
  const quote = await getSwapQuote(inputMint, outputMint, amount);

  // Step 2: Get swap transaction
  const response = await fetch("https://sanctum-s-api.fly.dev/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: inputMint,
      outputLstMint: outputMint,
      amount: amount.toString(),
      quotedAmount: quote.outAmount,
      signer: payer.publicKey.toBase58(),
      swapSrc: quote.routePlan[0]?.pool || "stakedex",
    }),
  });

  const { tx: serializedTx } = await response.json();

  // Step 3: Deserialize, sign, and send
  const txBuffer = Buffer.from(serializedTx, "base64");
  const transaction = VersionedTransaction.deserialize(txBuffer);
  transaction.sign([payer]);

  const sig = await connection.sendTransaction(transaction, {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, "confirmed");
  console.log("Swap executed:", sig);
  return sig;
}
```

### Depositing into Infinity Pool

```typescript
async function depositToInfinity(
  connection: Connection,
  payer: Keypair,
  lstMint: string,
  amount: number // in LST base units
) {
  // Depositing an LST into Infinity is a swap: LST -> INF
  const INF_MINT = "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm";

  return executeSwap(connection, payer, lstMint, INF_MINT, amount);
}
```

### Instant Unstake via Reserve Pool

```typescript
async function instantUnstake(
  connection: Connection,
  payer: Keypair,
  lstMint: string,
  amount: number
) {
  // Unstaking is a swap: LST -> SOL (native)
  const SOL_MINT = "So11111111111111111111111111111111111111112";

  return executeSwap(connection, payer, lstMint, SOL_MINT, amount);
}
```

## Common Patterns

### Comparing LST Yields

```typescript
async function compareLstYields() {
  const response = await fetch("https://sanctum-s-api.fly.dev/v1/apy/latest");
  const data = await response.json();

  // data.apys is a map of mint -> apy
  const lsts = Object.entries(data.apys)
    .map(([mint, apy]) => ({ mint, apy: Number(apy) }))
    .sort((a, b) => b.apy - a.apy);

  console.log("Top LSTs by APY:");
  for (const lst of lsts.slice(0, 10)) {
    console.log(`  ${lst.mint}: ${(lst.apy * 100).toFixed(2)}%`);
  }
}
```

### Monitoring Infinity Pool Composition

```typescript
async function getInfinityPoolComposition() {
  const response = await fetch("https://sanctum-s-api.fly.dev/v1/infinity/pool");
  const pool = await response.json();

  console.log("Infinity Pool composition:");
  for (const [lstMint, balance] of Object.entries(pool.lstBalances)) {
    const solValue = Number(balance) / 1e9;
    console.log(`  ${lstMint}: ${solValue.toFixed(2)} SOL equivalent`);
  }
  console.log(`Total INF supply: ${Number(pool.infSupply) / 1e9}`);
}
```

### Creating a Validator LST

```typescript
// Validator LSTs are created through Sanctum's onboarding process.
// The technical steps involve:

// 1. Create a single-validator stake pool using SPL Stake Pool program
import { createStakePool } from "@solana/spl-stake-pool";

async function createValidatorLst(
  connection: Connection,
  validator: Keypair,
  tokenName: string,
  tokenSymbol: string
) {
  // Create the stake pool restricted to one validator
  // This is a simplified view; full setup requires multiple accounts
  const poolKeypair = Keypair.generate();
  const mintKeypair = Keypair.generate();

  // The stake pool creation involves:
  // - Pool state account
  // - Pool token mint (the LST)
  // - Validator list (single entry)
  // - Reserve stake account
  // - Fee accounts

  console.log("Pool address:", poolKeypair.publicKey.toBase58());
  console.log("LST mint:", mintKeypair.publicKey.toBase58());

  // 2. Register token metadata (name, symbol, image)
  // 3. Apply for Sanctum whitelisting via sanctum.so/onboard
  // 4. Once whitelisted, the LST is tradeable via Router and Infinity

  return {
    pool: poolKeypair.publicKey,
    mint: mintKeypair.publicKey,
  };
}
```

### Batch Price Monitoring

```typescript
const POPULAR_LSTS: Record<string, string> = {
  "jitoSOL": "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "mSOL":    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "bSOL":    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "INF":     "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm",
  "bonkSOL": "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs",
};

async function monitorLstPrices() {
  const prices = await getLstPrices();

  for (const [name, mint] of Object.entries(POPULAR_LSTS)) {
    const price = prices[mint];
    if (price) {
      console.log(`${name}: ${price.toFixed(6)} SOL per token`);
    }
  }
}
```

## Gotchas and Tips

1. **Reserve pool capacity**: The reserve pool has a finite amount of SOL. During high-demand unstaking events (e.g., airdrops requiring native SOL), the reserve may be depleted. In this case, instant unstaking will fail and users must wait for the epoch boundary or use DEX swaps.

2. **INF is not 1:1 with SOL**: INF represents a share of the Infinity Pool, which holds multiple LSTs at different exchange rates. The SOL value of INF changes as the underlying LSTs accrue staking rewards. Always fetch the current price before calculating.

3. **LST exchange rates are not 1:1**: Each LST has its own exchange rate with SOL that increases over time as staking rewards accrue. When swapping between LSTs, the amounts will not be equal even for the same SOL value. Use the Sanctum quote API to get exact amounts.

4. **Whitelisting requirements**: Not all LSTs are accepted by the Infinity Pool or Router. Validators must apply through Sanctum's onboarding process. Check the current whitelist before building integrations that assume a specific LST is supported.

5. **Slippage on large swaps**: While the Infinity Pool is deep, very large swaps (thousands of SOL equivalent) can still incur slippage. The Router may split large swaps across multiple paths. Always use quotes and set slippage limits.

6. **API rate limits**: The Sanctum API has rate limits. For production applications, implement caching and exponential backoff. Consider fetching on-chain data directly for pricing if you need real-time updates.

7. **Epoch boundaries matter**: LST exchange rates update at epoch boundaries (~2-3 days). Staking rewards are not continuous; they are applied in discrete jumps. This can cause brief arbitrage opportunities at epoch transitions.

8. **Fee structure**: Sanctum charges small fees on Router swaps and Infinity Pool deposits/withdrawals. Fees vary by LST and operation. Always check the fee amount in the quote before executing.

9. **Validator LST risks**: Each validator LST concentrates stake in a single validator. If that validator has downtime or gets slashed, the LST's value can decrease. Infinity Pool diversifies this risk across many validators.

## Resources

- Sanctum App: https://app.sanctum.so
- Sanctum Docs: https://docs.sanctum.so
- Sanctum API: https://sanctum-s-api.fly.dev/v1
- Sanctum GitHub: https://github.com/sanctumso
- Infinity Pool: https://app.sanctum.so/infinity
- Validator LST Onboarding: https://sanctum.so/onboard
- S Token Info: https://docs.sanctum.so/s-token
- SPL Stake Pool Docs: https://spl.solana.com/stake-pool
- Sanctum Discord: https://discord.gg/sanctum
- Sanctum Blog: https://blog.sanctum.so
