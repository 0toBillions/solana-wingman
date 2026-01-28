# Drift Protocol

## TLDR

Drift is Solana's largest decentralized perpetual futures exchange, supporting perps, spot trading, and borrowing/lending with cross-margin. It uses a hybrid liquidity model combining a DLOB (Decentralized Limit Order Book), vAMM backstop, and JIT (Just-In-Time) liquidity. Use `@drift-labs/sdk` for all programmatic interactions.

## Overview

Drift Protocol provides a full-featured trading platform on Solana with perpetual futures (up to 20x leverage), spot trading, and a borrow/lend market. The protocol is designed around a unique multi-source liquidity model:

1. **JIT Auctions** - Market makers compete in a Dutch auction for each market order
2. **DLOB** - Decentralized limit order book maintained by keeper bots
3. **vAMM** - Virtual AMM that acts as backstop liquidity when no other source fills

This three-layer system ensures orders always get filled while providing competitive pricing.

```
Drift Liquidity Stack:

  Order comes in
       │
       ▼
┌─────────────┐    Best price,
│  JIT Auction │    ~5 second Dutch auction
│  (Makers)    │    for market makers
└──────┬──────┘
       │ unfilled portion
       ▼
┌─────────────┐    Matching engine
│    DLOB     │    matches against
│  (Keepers)  │    resting limit orders
└──────┬──────┘
       │ remaining unfilled
       ▼
┌─────────────┐    Backstop liquidity
│    vAMM     │    always available,
│  (Protocol) │    worst price
└─────────────┘
```

## Key Concepts

### Market Types

| Market Type | Description | Leverage | Settlement |
|-------------|-------------|----------|------------|
| Perpetual | Futures with no expiry | Up to 20x | Funding rate every hour |
| Spot | Direct asset trading | Up to 5x (margin) | Immediate |

### Order Types

```
Order Types in Drift:

Market Order     - Immediate execution at best available price
Limit Order      - Resting order at specified price
Trigger Market   - Market order activated when trigger price hit (stop-loss/take-profit)
Trigger Limit    - Limit order activated when trigger price hit
Oracle Order     - Price specified as offset from oracle price
                   e.g., "oracle - $0.50" adjusts dynamically
```

### Margin System

Drift uses **cross-margin** by default, meaning all positions in a subaccount share the same collateral pool.

| Margin Type | Initial | Maintenance | Description |
|-------------|---------|-------------|-------------|
| Initial | 5-10% | - | Required to open a position |
| Maintenance | - | 3.5-6.25% | Below this triggers liquidation |

**Health calculation**: `margin_ratio = total_collateral / margin_requirement`. When this falls below 1.0, the account becomes liquidatable.

### Subaccounts

Each wallet can have up to 8 subaccounts (index 0-7). Each subaccount is an independent margin account with its own positions, orders, and collateral. This enables isolated margin strategies.

## Architecture

### Program IDs

| Program | Address |
|---------|---------|
| Drift Program | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` |
| Drift State | PDA derived from `b"drift_state"` |

### Key Account Types

```
State (Global)
├── admin                    - Protocol admin authority
├── number_of_markets        - Total perp markets
├── number_of_spot_markets   - Total spot markets
├── oracle_guard_rails       - Oracle staleness/deviation thresholds
└── settlement_duration      - Revenue settlement config

User (Subaccount)
├── authority                - Wallet that owns this subaccount
├── sub_account_id           - Index (0-7)
├── settled_perp_pnl         - Realized PnL
├── perp_positions[8]        - Up to 8 perp positions
│   ├── market_index
│   ├── base_asset_amount    - Position size
│   ├── quote_asset_amount   - Entry cost basis
│   ├── last_cumulative_funding_rate
│   └── open_orders
├── spot_positions[8]        - Up to 8 spot balances
│   ├── market_index
│   ├── scaled_balance       - Deposit or borrow amount
│   └── balance_type         - Deposit or Borrow
├── orders[32]               - Up to 32 open orders
└── status                   - Active, BeingLiquidated, Bankrupt

PerpMarket
├── market_index
├── amm                      - vAMM state (reserves, peg, curves)
│   ├── base_asset_reserve
│   ├── quote_asset_reserve
│   ├── sqrt_k
│   ├── peg_multiplier
│   ├── cumulative_funding_rate_long
│   ├── cumulative_funding_rate_short
│   └── oracle               - Price oracle address
├── margin_ratio_initial     - Initial margin requirement
├── margin_ratio_maintenance - Maintenance margin requirement
├── insurance_claim          - Insurance fund allocation
└── status                   - Active, Settlement, etc.

SpotMarket
├── market_index
├── mint                     - Token mint address
├── vault                    - Token vault (PDA)
├── oracle                   - Price oracle
├── deposit_balance
├── borrow_balance
├── cumulative_deposit_interest
├── cumulative_borrow_interest
├── optimal_utilization      - Target utilization rate
├── optimal_borrow_rate      - Rate at optimal utilization
└── max_borrow_rate          - Rate at 100% utilization
```

## Integration Guide

### Installation

```bash
npm install @drift-labs/sdk @coral-xyz/anchor @solana/web3.js
```

### SDK Initialization

```typescript
import { DriftClient, Wallet, loadKeypair, initialize } from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const keypair = Keypair.fromSecretKey(/* your key */);
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, {});

const driftClient = new DriftClient({
  connection,
  wallet,
  env: "mainnet-beta",
  accountSubscription: {
    type: "websocket",
  },
});

await driftClient.subscribe();
console.log("Drift client ready");
```

### Deposit Collateral

```typescript
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const USDC_MARKET_INDEX = 0;
const depositAmount = new BN(1000 * 1e6); // 1000 USDC

// Deposit USDC into subaccount 0
const sig = await driftClient.deposit(
  depositAmount,
  USDC_MARKET_INDEX,
  await getAssociatedTokenAddress(
    new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    wallet.publicKey
  )
);
console.log("Deposited:", sig);
```

### Open a Perp Position

```typescript
import {
  PositionDirection,
  OrderType,
  MarketType,
  BASE_PRECISION,
  PRICE_PRECISION,
  getMarketOrderParams,
} from "@drift-labs/sdk";

// Market order: Long 1 SOL-PERP
const orderParams = getMarketOrderParams({
  marketIndex: 0, // SOL-PERP
  direction: PositionDirection.LONG,
  baseAssetAmount: BASE_PRECISION, // 1 SOL (1e9)
  marketType: MarketType.PERP,
});

const sig = await driftClient.placePerpOrder(orderParams);
console.log("Order placed:", sig);
```

### Place a Limit Order

```typescript
import { getLimitOrderParams } from "@drift-labs/sdk";

// Limit order: Buy 2 SOL-PERP at $90
const limitParams = getLimitOrderParams({
  marketIndex: 0,
  direction: PositionDirection.LONG,
  baseAssetAmount: new BN(2).mul(BASE_PRECISION),
  price: new BN(90).mul(PRICE_PRECISION),
  marketType: MarketType.PERP,
  postOnly: true, // Maker only, rejects if would cross
});

const sig = await driftClient.placePerpOrder(limitParams);
console.log("Limit order:", sig);
```

### Read Account State

```typescript
// Get user account
const user = driftClient.getUser();

// Check all perp positions
for (const position of user.getActivePerpPositions()) {
  const market = driftClient.getPerpMarketAccount(position.marketIndex);
  console.log(
    `Market ${position.marketIndex}:`,
    `Size: ${position.baseAssetAmount.toString()}`,
    `Entry: ${position.quoteEntryAmount.toString()}`,
    `Unrealized PnL: ${user.getUnrealizedPNL(true, position.marketIndex).toString()}`
  );
}

// Check free collateral
const freeCollateral = user.getFreeCollateral();
console.log("Free collateral:", freeCollateral.toString());

// Check margin ratio (health)
const marginRatio = user.getMarginRatio();
console.log("Margin ratio:", marginRatio.toString());

// Check liquidation price for a position
const liqPrice = user.liquidationPrice(0); // market index 0
console.log("Liquidation price:", liqPrice?.toString());
```

## Common Patterns

### Stop-Loss with Trigger Order

```typescript
import { getTriggerMarketOrderParams, OrderTriggerCondition } from "@drift-labs/sdk";

// Stop-loss: sell 1 SOL-PERP if price drops to $80
const stopLoss = getTriggerMarketOrderParams({
  marketIndex: 0,
  direction: PositionDirection.SHORT,
  baseAssetAmount: BASE_PRECISION,
  marketType: MarketType.PERP,
  triggerPrice: new BN(80).mul(PRICE_PRECISION),
  triggerCondition: OrderTriggerCondition.BELOW,
});

await driftClient.placePerpOrder(stopLoss);
```

### Withdraw Collateral

```typescript
const withdrawAmount = new BN(500 * 1e6); // 500 USDC

const sig = await driftClient.withdraw(
  withdrawAmount,
  USDC_MARKET_INDEX,
  await getAssociatedTokenAddress(
    new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    wallet.publicKey
  )
);
```

### Cancel Orders

```typescript
// Cancel all orders
await driftClient.cancelOrders();

// Cancel specific order by ID
await driftClient.cancelOrder(orderId);

// Cancel all orders for a specific market
await driftClient.cancelOrders(MarketType.PERP, 0); // SOL-PERP
```

## Gotchas and Tips

1. **Oracle dependency**: Drift relies heavily on Pyth and Switchboard oracles. All prices (margin calcs, liquidations, trigger orders) reference oracle prices, not vAMM prices. Stale oracles can block trading.

2. **Subaccount initialization**: Subaccount 0 is created automatically on first deposit. Additional subaccounts (1-7) must be explicitly initialized before use.

3. **Keeper bots required**: Limit orders, trigger orders, and liquidations are all executed by off-chain keeper bots. There is no guarantee of immediate execution. Run your own keeper for reliability.

4. **Funding rate**: Perp positions accrue funding every hour. Long pays short (or vice versa) based on the spread between mark and oracle price. This can be a significant cost for long-held positions.

5. **Account size limits**: Each subaccount can hold up to 8 perp positions, 8 spot positions, and 32 orders simultaneously. Plan around these limits.

6. **Remaining accounts**: Drift instructions require many remaining accounts (oracles, markets, user accounts). The SDK handles this, but manual instruction builders must include all readable/writable accounts or the transaction will fail.

7. **Settle PnL**: Realized perp PnL must be settled against the market's PnL pool before it becomes withdrawable. Use `driftClient.settlePNL()`.

8. **Insurance fund**: Each market has its own insurance fund. Revenue from fees flows to the insurance fund first, then to stakers. The fund covers socialized losses.

## Resources

- Documentation: https://docs.drift.trade/
- SDK Repository: https://github.com/drift-labs/protocol-v2
- npm: https://www.npmjs.com/package/@drift-labs/sdk
- TypeScript SDK: https://github.com/drift-labs/protocol-v2/tree/master/sdk
- Drift UI: https://app.drift.trade/
- Keeper Bot: https://github.com/drift-labs/keeper-bots-v2
- Technical Docs: https://drift-labs.github.io/v2-teacher/
