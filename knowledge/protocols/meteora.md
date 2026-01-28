# Meteora

## TLDR

Meteora offers two core AMM products on Solana: Dynamic AMM pools (constant-product with dynamic fees and virtual reserves) and DLMM (Discretized Liquidity Market Maker) pools that use a bin-based system for zero-slippage trades within active bins. Meteora is also the go-to platform for token launches via its Alpha Vault and launch pool features. Use `@meteora-ag/dlmm` for DLMM and `@mercurial-finance/dynamic-amm-sdk` for dynamic pools.

## Overview

Meteora provides liquidity infrastructure for Solana with two distinct pool architectures:

**Dynamic AMM Pools** enhance the classic constant-product model with dynamic fees that adjust based on market volatility and virtual reserves that improve capital efficiency. These pools are simpler to LP into (full-range, no active management) while capturing more fee revenue through smart fee adjustment.

**DLMM (Discretized Liquidity Market Maker)** takes a fundamentally different approach: liquidity is placed into discrete price **bins**, where each bin represents a single price point. When a swap occurs entirely within one bin, there is zero slippage. This gives LPs precise control over their liquidity distribution and pricing.

```
DLMM Bin-Based Liquidity:

Price ($)
  105 │ ░░░░          Bin with some liquidity
  104 │ ░░░░░░░░      More liquidity here
  103 │ ████████████  ◄── Active bin (current price)
  102 │ ░░░░░░░░░░    Token Y (quote) side
  101 │ ░░░░░░
  100 │ ░░░░
      └───────────────
       Liquidity depth

  Bins above active: Token X only (sell orders)
  Active bin: Mix of Token X and Token Y
  Bins below active: Token Y only (buy orders)
```

## Key Concepts

### DLMM Mechanics

**Bins**: Each bin holds liquidity at a single discrete price. The price of bin `i` is: `price(i) = (1 + binStep/10000) ^ (i - 8388608)`, where 8388608 is the center bin ID offset.

**Bin Step**: Determines the price increment between adjacent bins, measured in basis points. Common bin steps:

| Bin Step | Price Increment | Use Case |
|----------|----------------|----------|
| 1 | 0.01% | Stablecoin pairs |
| 5 | 0.05% | Tight-range LST pairs |
| 10 | 0.10% | Blue-chip pairs |
| 25 | 0.25% | Standard volatile pairs |
| 100 | 1.00% | High-volatility pairs |

**Active Bin**: The bin containing the current trading price. Only the active bin can contain both tokens. Bins above the active bin hold only token X (the base token), and bins below hold only token Y (the quote token).

**Liquidity Shapes**: When adding liquidity, LPs choose a distribution shape:

```
Spot (Uniform)        Curve (Normal)         Bid-Ask (Dumbbell)

│ ████████████│       │     ████     │       │████      ████│
│ ████████████│       │   ████████   │       │████      ████│
│ ████████████│       │ ████████████ │       │████      ████│
│ ████████████│       │████████████████      │████      ████│
└─────────────┘       └──────────────┘       └──────────────┘
 Equal across bins    Concentrated center    Edges get more
```

- **Spot**: Equal liquidity in every bin. Simple, even distribution.
- **Curve**: Gaussian-like, concentrated around the active bin. Best for range-bound markets.
- **Bid-Ask**: More liquidity at the edges, less in the middle. Good for volatile markets where you want to buy dips / sell rips.

### Dynamic AMM Pools

Dynamic AMM pools use a constant-product formula with enhancements:
- **Virtual reserves**: Concentrate liquidity around the current price without explicit ranges
- **Dynamic fees**: Fee rate adjusts based on recent volatility (higher vol = higher fees)
- **Protocol fee**: Configurable share of trading fees sent to the protocol

### Alpha Vault

Alpha Vault is Meteora's fair-launch mechanism for new tokens. It implements a time-weighted average price (TWAP) fill for initial buyers, preventing sniper bots and ensuring fair distribution. Projects create a vault that collects deposits during a deposit period, then fills all orders at a fair average price.

## Architecture

### Program IDs

| Program | Address |
|---------|---------|
| DLMM Program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| Dynamic AMM Program | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` |
| Alpha Vault Program | `vaU1tVLj8RFk7mNj1BxqgAsMKKaL8UvEUHvU3tdbZPe` |
| M3M3 Stake Program | `FEESngU3neckdwib9X3KWqdL7Mjmqk9XNp3uh5JbP4KP` |

### Key Account Types (DLMM)

```
LbPair (DLMM Pool)
├── token_x_mint              - Base token mint
├── token_y_mint              - Quote token mint
├── reserve_x                 - Token X vault (PDA)
├── reserve_y                 - Token Y vault (PDA)
├── bin_step                  - Price increment in bps
├── active_id                 - Currently active bin ID
├── base_fee_rate_bps         - Minimum fee rate
├── max_fee_rate_bps          - Maximum fee rate
├── protocol_fee_bps          - Protocol share of fees
├── parameters                - Dynamic fee parameters
│   ├── volatility_accumulator
│   ├── volatility_reference
│   ├── index_reference
│   └── filter_period
├── bin_arrays[]              - References to bin array accounts
└── oracle                    - On-chain oracle for TWAP

BinArray
├── lb_pair                   - Parent pool
├── index                     - Which segment of bins
└── bins[70]                  - Array of 70 bins
    ├── amount_x              - Token X in this bin
    ├── amount_y              - Token Y in this bin
    ├── price                 - Price for this bin (Q64.64)
    ├── liquidity_supply      - Total LP shares in bin
    └── fee_amount_x/y        - Accumulated fees

Position (V2)
├── lb_pair                   - Parent pool
├── owner                     - LP wallet
├── liquidity_shares[]        - Share of each bin
├── lower_bin_id              - First bin in position
├── upper_bin_id              - Last bin in position
├── fee_infos[]               - Fee tracking per bin
└── reward_infos[]            - Reward tracking per bin
```

## Integration Guide

### Installation

```bash
npm install @meteora-ag/dlmm @solana/web3.js @coral-xyz/anchor
```

### Initialize DLMM SDK

```typescript
import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(/* your key */);

// Load a specific DLMM pool
const SOL_USDC_POOL = new PublicKey("ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq"); // example
const dlmmPool = await DLMM.create(connection, SOL_USDC_POOL);

// Pool info
const poolState = dlmmPool.lbPair;
console.log("Active bin:", poolState.activeId);
console.log("Bin step:", poolState.binStep);
console.log("Token X:", poolState.tokenXMint.toBase58());
console.log("Token Y:", poolState.tokenYMint.toBase58());
```

### Get Active Bin Price

```typescript
const activeBin = await dlmmPool.getActiveBin();
console.log("Active bin ID:", activeBin.binId);
console.log("Price:", activeBin.price); // Human-readable price

// Get multiple bins around active
const bins = await dlmmPool.getBinsBetweenLowerAndUpperBound(
  poolState.activeId - 10,
  poolState.activeId + 10
);

for (const bin of bins) {
  console.log(`Bin ${bin.binId}: price=${bin.price}, x=${bin.amountX}, y=${bin.amountY}`);
}
```

### Add Liquidity (Spot Distribution)

```typescript
import { StrategyType, BN } from "@meteora-ag/dlmm";

const activeBinId = poolState.activeId;

// Add liquidity across 10 bins centered on active bin
const totalXAmount = new BN(1_000_000_000); // 1 SOL
const totalYAmount = new BN(100_000_000);   // 100 USDC

const addLiqTx = await dlmmPool.addLiquidityByStrategy({
  positionPubKey: positionKeypair.publicKey, // new Keypair for position
  totalXAmount,
  totalYAmount,
  strategy: {
    maxBinId: activeBinId + 5,
    minBinId: activeBinId - 5,
    strategyType: StrategyType.SpotImBalanced, // uniform distribution
  },
  user: wallet.publicKey,
  slippage: 50, // 0.5% in bps
});

// Sign and send (may be multiple transactions)
for (const tx of addLiqTx) {
  const sig = await connection.sendTransaction(tx, [wallet, positionKeypair]);
  console.log("Add liquidity tx:", sig);
}
```

### Add Liquidity (Curve Distribution)

```typescript
// Gaussian/curve distribution - more liquidity near active bin
const curveTx = await dlmmPool.addLiquidityByStrategy({
  positionPubKey: positionKeypair.publicKey,
  totalXAmount: new BN(1_000_000_000),
  totalYAmount: new BN(100_000_000),
  strategy: {
    maxBinId: activeBinId + 15,
    minBinId: activeBinId - 15,
    strategyType: StrategyType.CurveBalanced,
  },
  user: wallet.publicKey,
  slippage: 50,
});
```

### Execute a Swap

```typescript
import { BN } from "@coral-xyz/anchor";

const swapAmount = new BN(500_000_000); // 0.5 SOL
const swapYtoX = false; // false = swap X to Y (SOL to USDC)

// Get quote
const quote = await dlmmPool.swapQuote(swapAmount, swapYtoX, new BN(10)); // 10 bps slippage

console.log("Amount in:", swapAmount.toString());
console.log("Amount out:", quote.outAmount.toString());
console.log("Fee:", quote.fee.toString());
console.log("Price impact:", quote.priceImpact.toString());

// Execute swap
const swapTx = await dlmmPool.swap({
  inToken: poolState.tokenXMint,
  outToken: poolState.tokenYMint,
  inAmount: swapAmount,
  minOutAmount: quote.outAmount, // from quote
  lbPair: SOL_USDC_POOL,
  user: wallet.publicKey,
  binArraysPubkey: quote.binArraysPubkey, // required bin arrays
});

const sig = await connection.sendTransaction(swapTx, [wallet]);
console.log("Swap:", sig);
```

### Claim Fees and Rewards

```typescript
// Get all positions for the user
const positions = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);

for (const position of positions.userPositions) {
  console.log("Position:", position.publicKey.toBase58());
  console.log("Fee X owed:", position.positionData.feeX.toString());
  console.log("Fee Y owed:", position.positionData.feeY.toString());

  // Claim fees
  const claimTx = await dlmmPool.claimAllFees({
    owner: wallet.publicKey,
    positions: [position],
  });
  const sig = await connection.sendTransaction(claimTx, [wallet]);
  console.log("Claimed fees:", sig);
}
```

### Remove Liquidity

```typescript
// Remove all liquidity from a position
const position = positions.userPositions[0];
const binIds = position.positionData.positionBinData.map(b => b.binId);

// 100% removal from all bins
const bpsPerBin = binIds.map(() => new BN(10000)); // 10000 bps = 100%

const removeTx = await dlmmPool.removeLiquidity({
  position: position.publicKey,
  user: wallet.publicKey,
  binIds,
  bps: bpsPerBin,
  shouldClaimAndClose: true, // claim fees and close position account
});

for (const tx of removeTx) {
  const sig = await connection.sendTransaction(tx, [wallet]);
  console.log("Remove liquidity:", sig);
}
```

## Common Patterns

### Find All DLMM Pools for a Token Pair

```typescript
const allPools = await DLMM.getLbPairs(connection, {
  tokenXMint: SOL_MINT,
  tokenYMint: USDC_MINT,
});

for (const pool of allPools) {
  console.log(
    `Pool: ${pool.publicKey.toBase58()}, bin_step: ${pool.account.binStep}, active: ${pool.account.activeId}`
  );
}
```

### Dynamic AMM Pool Interaction

```typescript
import AmmImpl from "@mercurial-finance/dynamic-amm-sdk";

const ammPool = await AmmImpl.create(connection, DYNAMIC_POOL_ADDRESS);

// Get pool info
const poolInfo = ammPool.poolInfo;
console.log("Token A:", poolInfo.tokenAMint.toBase58());
console.log("Token B:", poolInfo.tokenBMint.toBase58());
console.log("Virtual price:", ammPool.virtualPrice);

// Deposit balanced liquidity
const depositTx = await ammPool.deposit(
  wallet.publicKey,
  new BN(1_000_000_000), // token A amount
  new BN(100_000_000),   // token B amount
  new BN(0)              // min LP tokens (set properly in production)
);

const sig = await connection.sendTransaction(depositTx, [wallet]);
```

## Gotchas and Tips

1. **Bin arrays must exist**: Before adding liquidity to bins, the corresponding bin array accounts must be initialized. The SDK handles this, but check if you are building transactions manually. Each bin array holds 70 bins.

2. **Active bin can change mid-transaction**: During volatile markets, the active bin may shift between your quote and execution. Always include slippage tolerance.

3. **Zero-slippage only within a bin**: Swaps that stay within a single bin truly have zero slippage. Larger swaps that cross multiple bins experience slippage as each bin has a discrete price.

4. **Position keypair management**: DLMM V1 positions require a new Keypair per position. Store these keypairs securely. V2 positions use PDAs derived from the user's wallet.

5. **Token ordering**: In DLMM, token X is the base (numerically smaller mint) and token Y is the quote. Getting this wrong will cause PDA derivation to fail.

6. **Dynamic fee volatility**: DLMM dynamic fees can spike during volatile periods. The fee = base_fee + variable_fee, where variable_fee scales with the volatility accumulator. This is great for LPs but can surprise traders.

7. **Alpha Vault timing**: Alpha Vault deposits have a specific deposit window. Deposits after the window closes are rejected. The fill price is determined by TWAP, not by order of deposit.

8. **Launch pool lock-up**: Tokens acquired through Alpha Vault may have a vesting or lock-up period. Check the vault configuration for unlock schedules before depositing.

9. **Multiple transactions for wide ranges**: Adding liquidity across many bins may require multiple transactions due to Solana's compute limits. The SDK returns an array of transactions; send them all.

## Resources

- Documentation: https://docs.meteora.ag/
- DLMM SDK: https://www.npmjs.com/package/@meteora-ag/dlmm
- Dynamic AMM SDK: https://www.npmjs.com/package/@mercurial-finance/dynamic-amm-sdk
- GitHub: https://github.com/MeteoraAg
- DLMM Source: https://github.com/MeteoraAg/dlmm-sdk
- Meteora UI: https://app.meteora.ag/
- Alpha Vault Docs: https://docs.meteora.ag/alpha-vault/overview
