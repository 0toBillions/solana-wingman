# Orca Whirlpools

## TLDR

Orca is Solana's leading concentrated liquidity AMM, built around the Whirlpools CLMM model. Liquidity providers set custom price ranges using tick-based mechanics, enabling far greater capital efficiency than traditional constant-product AMMs. Use the `@orca-so/whirlpools-sdk` for all integration work.

## Overview

Orca Whirlpools implements concentrated liquidity market making (CLMM) on Solana, similar in concept to Uniswap V3 but purpose-built for Solana's architecture. Liquidity providers deposit assets into specific price ranges (defined by ticks), earning trading fees only when the current price falls within their range. This concentrates liquidity where it matters most, dramatically improving swap execution for traders and fee yield for LPs.

Key value propositions:
- **Capital efficiency**: Up to 100x more effective than constant-product AMMs
- **Customizable ranges**: LPs choose exact price bounds
- **Multiple fee tiers**: Different tick spacings for different volatility profiles
- **Composable positions**: Each position is a unique on-chain account

```
Whirlpool Concentrated Liquidity Model:

Price
  ^
  |         ┌──────┐
  |     ┌───┤ LP B ├──┐
  |  ┌──┤   └──────┘  ├──┐
  |  │  │   ┌──────┐  │  │
  |  │  │   │ LP A │  │  │     LP A: tight range, high fees/tick
  |  │  └───┤      ├──┘  │     LP B: wider range, lower fees/tick
  |  │      └──────┘     │     LP C: widest range
  |  │    ┌──────────┐   │
  |  └────┤   LP C   ├───┘
  |       └──────────┘
  └──────────────────────────> Ticks
       Lower            Upper
```

## Key Concepts

### Ticks and Tick Arrays

Ticks are discrete price points that define the boundaries of liquidity positions. Orca groups ticks into **tick arrays** (blocks of 88 ticks) stored as on-chain accounts to manage Solana's account model efficiently.

| Tick Spacing | Fee Tier | Best For |
|-------------|----------|----------|
| 1 | 0.01% | Stablecoins (USDC/USDT) |
| 8 | 0.04% | Tight pegs (mSOL/SOL) |
| 64 | 0.30% | Standard pairs (SOL/USDC) |
| 128 | 1.00% | Volatile/exotic pairs |

**Tick math**: Price at tick `i` = `1.0001^i`. This means each tick represents a 0.01% price change, giving very fine-grained control over position ranges.

```typescript
// Convert price to tick index
function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// Convert tick index to price
function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

// Tick must be aligned to the pool's tick spacing
function alignTick(tick: number, tickSpacing: number): number {
  return Math.floor(tick / tickSpacing) * tickSpacing;
}
```

### Positions

A position represents a liquidity deposit within a specific tick range. Each position is a unique Solana account (PDA) that tracks:
- The lower and upper tick boundaries
- The amount of liquidity deposited
- Uncollected fees owed to the position
- Uncollected reward emissions

### Whirlpool Account

The Whirlpool account stores the pool state including current price (stored as `sqrt_price`), current tick index, liquidity in the active tick range, fee rate, protocol fee rate, and reward emission configuration.

## Architecture

### Program IDs

| Program | Address |
|---------|---------|
| Whirlpool Program | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3wMFPjf` |
| Whirlpools Config | `2LecshUwPBNMiavwEQ9oQ4F6rJNeJAx1abBQ2fHKm8C3` |

### Key Account Types

```
Whirlpool (Pool)
├── token_mint_a          - First token mint
├── token_mint_b          - Second token mint
├── token_vault_a         - PDA holding token A reserves
├── token_vault_b         - PDA holding token B reserves
├── tick_spacing          - Determines fee tier
├── sqrt_price            - Current price as Q64.64 sqrt
├── tick_current_index    - Current active tick
├── liquidity             - Active liquidity in current tick
├── fee_rate              - Swap fee in bps (hundredths of a bp)
├── protocol_fee_rate     - Protocol's share of fees
├── reward_infos[3]       - Up to 3 reward emissions
└── fee_growth_global_*   - Global fee accumulators

Position
├── whirlpool             - Parent pool address
├── position_mint         - NFT mint representing ownership
├── tick_lower_index      - Lower bound tick
├── tick_upper_index      - Upper bound tick
├── liquidity             - Amount of liquidity
├── fee_owed_a            - Uncollected fee for token A
├── fee_owed_b            - Uncollected fee for token B
└── reward_infos[3]       - Uncollected reward emissions

TickArray
├── whirlpool             - Parent pool address
├── start_tick_index      - First tick in this array
└── ticks[88]             - Array of tick data
```

## Integration Guide

### Installation

```bash
npm install @orca-so/whirlpools-sdk @orca-so/common-sdk @coral-xyz/anchor @solana/web3.js @solana/spl-token decimal.js
```

### SDK Initialization

```typescript
import { WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID } from "@orca-so/whirlpools-sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = new Wallet(Keypair.fromSecretKey(/* your key */));
const provider = new AnchorProvider(connection, wallet, {});

const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
const client = buildWhirlpoolClient(ctx);
```

### Fetch a Whirlpool

```typescript
import { PDAUtil } from "@orca-so/whirlpools-sdk";

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TICK_SPACING = 64; // 0.30% fee tier

// Derive the whirlpool PDA
const whirlpoolPda = PDAUtil.getWhirlpool(
  ORCA_WHIRLPOOL_PROGRAM_ID,
  new PublicKey("2LecshUwPBNMiavwEQ9oQ4F6rJNeJAx1abBQ2fHKm8C3"), // config
  SOL_MINT,
  USDC_MINT,
  TICK_SPACING
);

const whirlpool = await client.getPool(whirlpoolPda.publicKey);
const poolData = whirlpool.getData();
console.log("Current price:", whirlpool.getTokenAInfo(), poolData.sqrtPrice);
```

### Open a Position

```typescript
import { increaseLiquidityQuoteByInputToken, PriceMath, TickUtil } from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

// Define price range
const currentPrice = PriceMath.sqrtPriceX64ToPrice(
  poolData.sqrtPrice,
  whirlpool.getTokenAInfo().decimals,
  whirlpool.getTokenBInfo().decimals
);

// Set range: current price +/- 10%
const lowerPrice = currentPrice.mul(0.9);
const upperPrice = currentPrice.mul(1.1);

const lowerTick = TickUtil.getInitializableTickIndex(
  PriceMath.priceToTickIndex(lowerPrice, whirlpool.getTokenAInfo().decimals, whirlpool.getTokenBInfo().decimals),
  TICK_SPACING
);
const upperTick = TickUtil.getInitializableTickIndex(
  PriceMath.priceToTickIndex(upperPrice, whirlpool.getTokenAInfo().decimals, whirlpool.getTokenBInfo().decimals),
  TICK_SPACING
);

// Get deposit quote for 1 SOL
const quote = increaseLiquidityQuoteByInputToken(
  SOL_MINT,
  new Decimal(1), // 1 SOL
  lowerTick,
  upperTick,
  Percentage.fromFraction(1, 100), // 1% slippage
  whirlpool
);

console.log("Token A (SOL):", quote.tokenEstA.toString());
console.log("Token B (USDC):", quote.tokenEstB.toString());

// Open position and add liquidity in one transaction
const { positionMint, tx } = await whirlpool.openPositionWithMetadata(
  lowerTick,
  upperTick,
  quote
);

const signature = await tx.buildAndExecute();
console.log("Position opened:", positionMint.toBase58(), "tx:", signature);
```

### Execute a Swap

```typescript
import { swapQuoteByInputToken } from "@orca-so/whirlpools-sdk";

// Swap 0.5 SOL to USDC
const swapQuote = await swapQuoteByInputToken(
  whirlpool,
  SOL_MINT,
  new BN(0.5 * 1e9), // 0.5 SOL in lamports
  Percentage.fromFraction(1, 100), // 1% slippage
  ctx.program.programId,
  ctx.fetcher
);

console.log("Estimated output:", swapQuote.estimatedAmountOut.toString(), "USDC (raw)");

const swapTx = await whirlpool.swap(swapQuote);
const sig = await swapTx.buildAndExecute();
console.log("Swap executed:", sig);
```

### Collect Fees and Rewards

```typescript
import { collectFeesQuote, collectRewardsQuote } from "@orca-so/whirlpools-sdk";

const position = await client.getPosition(positionAddress);
const positionData = position.getData();

// Check uncollected fees
const feeQuote = collectFeesQuote({
  whirlpool: poolData,
  position: positionData,
  tickLower: position.getLowerTickData(),
  tickUpper: position.getUpperTickData(),
});

console.log("Fees owed A:", feeQuote.feeOwedA.toString());
console.log("Fees owed B:", feeQuote.feeOwedB.toString());

// Collect fees + rewards in one transaction
const collectTx = await position.collectFees();
const rewardTx = await position.collectRewards();
// Can merge transactions
const sig = await collectTx.addSigner(wallet).buildAndExecute();
```

## Common Patterns

### Close a Position

```typescript
// 1. Collect all fees and rewards first
await position.collectFees().then(tx => tx.buildAndExecute());
await position.collectRewards().then(tx => tx.buildAndExecute());

// 2. Remove all liquidity
const decreaseQuote = decreaseLiquidityQuoteByLiquidity(
  positionData.liquidity,
  Percentage.fromFraction(1, 100),
  position,
  whirlpool
);
await position.decreaseLiquidity(decreaseQuote).then(tx => tx.buildAndExecute());

// 3. Close the position account
await position.closePosition(wallet.publicKey, wallet.publicKey)
  .then(tx => tx.buildAndExecute());
```

### Find All Positions for a Wallet

```typescript
import { getAllPositionAccountsByOwner } from "@orca-so/whirlpools-sdk";

const positions = await getAllPositionAccountsByOwner(
  ctx,
  wallet.publicKey
);

for (const pos of positions) {
  console.log(
    "Position:", pos.publicKey.toBase58(),
    "Pool:", pos.data.whirlpool.toBase58(),
    "Liquidity:", pos.data.liquidity.toString()
  );
}
```

## Gotchas and Tips

1. **Tick alignment**: Ticks MUST be aligned to the pool's tick spacing. Use `TickUtil.getInitializableTickIndex()` or your transactions will fail.

2. **Tick arrays must be initialized**: Before opening a position in a new tick range, the corresponding tick array accounts must exist. The SDK handles this, but if building raw transactions, you must initialize them first.

3. **Token ordering matters**: In a Whirlpool, token A always has the numerically smaller mint address. If you pass mints out of order, PDA derivation will fail silently and return the wrong address.

4. **sqrt_price format**: On-chain price is stored as a Q64.64 fixed-point square root. Never compare raw sqrtPrice values to human-readable prices; use `PriceMath.sqrtPriceX64ToPrice()`.

5. **Fees are not auto-compounded**: Unlike some protocols, Orca does not auto-compound fees into positions. You must manually collect and re-deposit to compound.

6. **Multiple tick arrays per swap**: A single swap may cross multiple tick arrays. The SDK resolves the required accounts, but custom instruction builders must include up to 3 tick array accounts.

7. **Position NFTs**: Each position mints an NFT. The position owner is whoever holds the NFT, enabling transferable LP positions.

8. **Rent exemption**: Position and tick array accounts require SOL for rent exemption. Closing positions reclaims this rent.

## Resources

- Documentation: https://orca-so.github.io/whirlpools/
- SDK Repository: https://github.com/orca-so/whirlpools
- npm: https://www.npmjs.com/package/@orca-so/whirlpools-sdk
- Program Source: https://github.com/orca-so/whirlpools/tree/main/programs/whirlpool
- Orca UI: https://www.orca.so/
- Whirlpool Explorer: https://everlastingsong.github.io/account-microscope/
