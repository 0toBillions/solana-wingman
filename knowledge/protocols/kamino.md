# Kamino Finance

## TLDR

Kamino Finance combines lending/borrowing (Kamino Lend) with automated concentrated liquidity management (Kamino Liquidity) on Solana. Deposits into lending reserves mint kTokens representing your share, which can then be used as collateral for borrowing. Use `@kamino-finance/klend-sdk` for lending and `@kamino-finance/kliquidity-sdk` for liquidity vaults.

## Overview

Kamino has two main product lines:

**Kamino Lend (K-Lend)** is a lending/borrowing protocol where users deposit assets to earn yield and borrow against their collateral. It uses a pool-based model with isolated and cross-margin markets, supporting a wide range of Solana assets including LSTs, stablecoins, and LP tokens.

**Kamino Liquidity** automates CLMM position management on Orca Whirlpools and Raydium CLMM. Users deposit into strategy vaults that auto-rebalance, auto-compound fees, and manage tick ranges. The vault shares (kTokens) are composable and can be used as collateral in K-Lend.

```
Kamino Finance Ecosystem:

┌──────────────────────────────────────────────┐
│                  Kamino Lend                  │
│                                              │
│  Deposit SOL ──► kSOL (interest-bearing)     │
│  Deposit USDC ──► kUSDC                      │
│                                              │
│  Use kTokens as collateral ──► Borrow USDC   │
│                                              │
│  Liquidation if health factor < 1.0          │
├──────────────────────────────────────────────┤
│              Kamino Liquidity                 │
│                                              │
│  Deposit SOL+USDC ──► kSOL-USDC vault token  │
│       │                                      │
│       ├─ Auto-rebalance CLMM ranges          │
│       ├─ Auto-compound fees + rewards         │
│       └─ Managed by strategy config           │
│                                              │
│  kSOL-USDC vault token usable as collateral  │
│  in Kamino Lend (composability)              │
└──────────────────────────────────────────────┘
```

## Key Concepts

### Kamino Lend

**Reserves**: Each supported asset has a reserve account that tracks total deposits, total borrows, interest rates, and oracle configuration. Interest accrues continuously using a utilization-based model.

**kTokens**: When you deposit into a reserve, you receive kTokens (e.g., deposit SOL, get kSOL). kTokens are interest-bearing: the exchange rate grows over time as borrowers pay interest. They are standard SPL tokens and can be transferred or composed.

**Interest Rate Model**:

| Utilization | Rate Behavior |
|-------------|--------------|
| 0% - Optimal | Gradual linear increase |
| Optimal (e.g., 80%) | Slope inflection point |
| Optimal - 100% | Steep exponential increase |

```typescript
// Simplified interest rate calculation
function getBorrowRate(utilization: number, optimal: number, slope1: number, slope2: number): number {
  if (utilization <= optimal) {
    return (utilization / optimal) * slope1;
  } else {
    return slope1 + ((utilization - optimal) / (1 - optimal)) * slope2;
  }
}
```

**Health Factor**: Measures collateral safety. `health_factor = risk_adjusted_collateral / risk_adjusted_liabilities`. When health factor drops below 1.0, the position can be liquidated.

**Elevation Groups**: Kamino uses elevation groups to define special relationships between assets. For example, SOL and mSOL in the same elevation group may have higher LTV ratios because their prices are correlated.

### Kamino Liquidity

**Strategy Vaults**: Pre-configured vaults that manage CLMM positions. Each vault has a strategy type (e.g., stable, volatile) that determines rebalancing behavior.

**Rebalancing**: Keeper bots monitor positions and rebalance when the price moves outside the target range. Rebalancing withdraws liquidity, adjusts tick range, and re-deposits.

## Architecture

### Program IDs

| Program | Address |
|---------|---------|
| Kamino Lending (K-Lend) | `KLend2g3cP87ber41GNtKzezKJz24SJwfqc73HGK1bM` |
| Kamino Liquidity | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc` |
| Kamino Farms | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` |

### Key Account Types (Lending)

```
LendingMarket
├── owner                    - Market admin authority
├── quote_currency           - Price denomination (usually USD)
├── emergency_mode           - Circuit breaker flag
├── autodeleverage_enabled   - Auto-deleverage toggle
└── elevation_groups[]       - Special asset group configs

Reserve
├── lending_market           - Parent market
├── liquidity
│   ├── mint_pubkey          - Underlying token mint
│   ├── supply_vault         - PDA holding deposited tokens
│   ├── available_amount     - Tokens available for borrowing
│   ├── borrowed_amount_sf   - Total borrowed (scaled fraction)
│   ├── cumulative_borrow_rate_bsf - Interest accumulator
│   └── market_price_sf      - Last oracle price
├── collateral
│   ├── mint_pubkey          - kToken mint address
│   ├── supply               - Total kTokens outstanding
│   └── mint_total_supply    - Matches collateral supply
├── config
│   ├── loan_to_value_pct    - Max LTV for borrowing
│   ├── liquidation_threshold_pct - LTV that triggers liquidation
│   ├── liquidation_bonus_pct - Bonus for liquidators
│   ├── borrow_rate_curve    - Interest rate parameters
│   ├── deposit_limit        - Max deposits allowed
│   ├── borrow_limit         - Max borrows allowed
│   └── token_info           - Oracle config, decimals, etc.
└── rate_limiter             - Throttle large operations

Obligation (User Account)
├── lending_market           - Parent market
├── owner                    - User wallet
├── deposits[]               - Array of collateral deposits
│   ├── deposit_reserve      - Which reserve
│   └── deposited_amount     - kTokens deposited
├── borrows[]                - Array of outstanding borrows
│   ├── borrow_reserve       - Which reserve
│   ├── borrowed_amount_sf   - Amount owed (scaled)
│   └── cumulative_borrow_rate_bsf - For interest calc
├── deposited_value_sf       - Total collateral value (USD)
├── borrowed_value_sf        - Total borrow value (USD)
└── allowed_borrow_value_sf  - Max borrowable (USD)
```

## Integration Guide

### Installation

```bash
npm install @kamino-finance/klend-sdk @solana/web3.js @coral-xyz/anchor
```

### SDK Initialization

```typescript
import { KaminoMarket, KaminoAction, PROGRAM_ID } from "@kamino-finance/klend-sdk";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(/* your key */);

// Main market address
const KAMINO_MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");

const market = await KaminoMarket.load(
  connection,
  KAMINO_MAIN_MARKET,
  PROGRAM_ID
);
await market.loadReserves();
```

### Deposit (Supply) Assets

```typescript
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const depositAmount = 1_000_000_000; // 1 SOL in lamports

const depositAction = await KaminoAction.buildDepositTxns(
  market,
  depositAmount.toString(),
  SOL_MINT,
  wallet.publicKey,
  new PublicKey("KaminoObligationV1111111111111111111111111") // obligation type
);

// Build and send all setup + main + cleanup transactions
const setupIxs = depositAction.setupIxs;
const mainIxs = depositAction.lendingIxs;
const cleanupIxs = depositAction.cleanupIxs;

// Combine into a transaction (simplified)
const tx = new Transaction();
setupIxs.forEach(ix => tx.add(ix));
mainIxs.forEach(ix => tx.add(ix));
cleanupIxs.forEach(ix => tx.add(ix));

const sig = await connection.sendTransaction(tx, [wallet]);
console.log("Deposited:", sig);
```

### Borrow Assets

```typescript
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const borrowAmount = 100_000_000; // 100 USDC

const borrowAction = await KaminoAction.buildBorrowTxns(
  market,
  borrowAmount.toString(),
  USDC_MINT,
  wallet.publicKey,
  new PublicKey("KaminoObligationV1111111111111111111111111")
);

const tx = new Transaction();
borrowAction.setupIxs.forEach(ix => tx.add(ix));
borrowAction.lendingIxs.forEach(ix => tx.add(ix));
borrowAction.cleanupIxs.forEach(ix => tx.add(ix));

const sig = await connection.sendTransaction(tx, [wallet]);
console.log("Borrowed:", sig);
```

### Check Obligation Health

```typescript
// Load user's obligation
const obligations = await market.getObligationsByOwner(wallet.publicKey);

for (const obligation of obligations) {
  const stats = obligation.getStats();
  console.log("Deposited value (USD):", stats.userTotalDeposit.toFixed(2));
  console.log("Borrowed value (USD):", stats.userTotalBorrow.toFixed(2));
  console.log("Borrow limit (USD):", stats.borrowLimit.toFixed(2));
  console.log("Liquidation threshold:", stats.liquidationLtv.toFixed(4));

  // Health factor: > 1 is safe, < 1 is liquidatable
  const healthFactor = stats.liquidationLtv > 0
    ? stats.userTotalDeposit / (stats.userTotalBorrow / stats.liquidationLtv)
    : Infinity;
  console.log("Health factor:", healthFactor.toFixed(4));
}
```

### Repay a Loan

```typescript
const repayAmount = 50_000_000; // 50 USDC

const repayAction = await KaminoAction.buildRepayTxns(
  market,
  repayAmount.toString(),
  USDC_MINT,
  wallet.publicKey,
  new PublicKey("KaminoObligationV1111111111111111111111111")
);

const tx = new Transaction();
repayAction.setupIxs.forEach(ix => tx.add(ix));
repayAction.lendingIxs.forEach(ix => tx.add(ix));
repayAction.cleanupIxs.forEach(ix => tx.add(ix));

const sig = await connection.sendTransaction(tx, [wallet]);
console.log("Repaid:", sig);
```

## Common Patterns

### Leveraged LST Yield (SOL Loop)

A popular strategy: deposit mSOL, borrow SOL, swap SOL for mSOL, deposit again. This loops the staking yield.

```typescript
// Pseudocode for leverage loop
async function leverageLoop(market: KaminoMarket, wallet: Keypair, loops: number) {
  for (let i = 0; i < loops; i++) {
    // 1. Deposit mSOL as collateral
    const depositAction = await KaminoAction.buildDepositTxns(
      market, msolAmount.toString(), MSOL_MINT, wallet.publicKey, obligationType
    );
    await sendTx(depositAction);

    // 2. Borrow SOL against mSOL collateral
    const borrowAction = await KaminoAction.buildBorrowTxns(
      market, solAmount.toString(), SOL_MINT, wallet.publicKey, obligationType
    );
    await sendTx(borrowAction);

    // 3. Swap SOL -> mSOL via Jupiter
    // (use Jupiter API)

    // 4. Repeat with new mSOL
  }
}
```

### Read Reserve Data

```typescript
const reserves = market.reserves;

for (const [address, reserve] of reserves) {
  const stats = reserve.getReserveStats();
  console.log(`Reserve: ${reserve.symbol}`);
  console.log(`  Supply APY: ${(stats.supplyAPY * 100).toFixed(2)}%`);
  console.log(`  Borrow APY: ${(stats.borrowAPY * 100).toFixed(2)}%`);
  console.log(`  Utilization: ${(stats.utilizationRate * 100).toFixed(2)}%`);
  console.log(`  Total supply: $${stats.totalSupplyUSD.toFixed(2)}`);
  console.log(`  Total borrows: $${stats.totalBorrowUSD.toFixed(2)}`);
  console.log(`  LTV: ${reserve.config.loanToValuePct}%`);
  console.log(`  Liq threshold: ${reserve.config.liquidationThresholdPct}%`);
}
```

## Gotchas and Tips

1. **Obligation types matter**: Kamino has different obligation types (vanilla, multiply, leverage). Each has different allowed operations. Using the wrong obligation type will cause transactions to fail.

2. **kToken exchange rate**: kTokens appreciate over time. When calculating positions, always use the current exchange rate from the reserve, not 1:1. `underlying_amount = ktoken_amount * exchange_rate`.

3. **Elevation groups for correlated assets**: Assets in the same elevation group (e.g., SOL and mSOL) may have relaxed LTV limits. Always check the elevation group config for accurate max leverage.

4. **Refresh instructions required**: Before deposit, borrow, or liquidation, the reserve and obligation must be refreshed. The SDK includes these automatically, but manual instruction builders must prepend refresh instructions.

5. **Deposit and borrow limits**: Each reserve has hard caps on total deposits and borrows. Check `reserve.config.depositLimit` and `reserve.config.borrowLimit` before transacting.

6. **Liquidation bonus varies**: Different reserves offer different liquidation bonuses (typically 2-15%). Higher-risk assets have higher bonuses to incentivize liquidators.

7. **Oracle staleness**: Kamino uses Pyth and Switchboard oracles with staleness checks. If an oracle is stale, operations on that reserve may be blocked.

8. **Multiple transactions**: Complex operations (deposit + borrow) may require multiple transactions due to Solana's compute and account limits. The SDK splits these automatically into setup, lending, and cleanup phases.

## Resources

- Documentation: https://docs.kamino.finance/
- K-Lend SDK: https://www.npmjs.com/package/@kamino-finance/klend-sdk
- K-Liquidity SDK: https://www.npmjs.com/package/@kamino-finance/kliquidity-sdk
- SDK Source: https://github.com/Kamino-Finance/klend-sdk
- Kamino UI: https://app.kamino.finance/
- Risk Dashboard: https://risk.kamino.finance/
