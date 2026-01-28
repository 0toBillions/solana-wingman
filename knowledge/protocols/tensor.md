# Tensor

## TLDR

Tensor is the leading NFT marketplace and AMM on Solana, supporting standard NFTs, compressed NFTs (cNFTs), and pool-based automated market making for collections. It provides orderbook-style trading with collection-wide bids, real-time price feeds, and an AMM inspired by sudoswap that lets LPs provide liquidity for entire NFT collections. Tensor handles royalty enforcement natively and supports the full lifecycle of NFT trading through multiple on-chain programs.

## Overview

Tensor operates as a suite of on-chain programs that together form a complete NFT trading infrastructure:

- **TSwap (Tensorswap)**: The core marketplace program handling listings, bids, and instant sales for standard NFTs.
- **TAMMv2 (Tensor AMM v2)**: A pool-based AMM that allows users to create liquidity pools for NFT collections, enabling instant buys and sells against bonding curves.
- **TComp (Tensor Compressed)**: A dedicated program for trading compressed NFTs (cNFTs) which use Metaplex Bubblegum and state compression.
- **TBid**: Handles collection-wide and trait-based bidding across all NFT types.

Tensor dominates Solana NFT volume due to its speed, low fees (typically 1.5% taker fee), and pro-trader features like real-time collection stats, rarity filters, and batch operations.

## Key Concepts

### Orderbook Model
Tensor uses an on-chain orderbook rather than a simple listing/auction model. Sellers create listings (asks) and buyers create bids. When a bid matches a listing, the trade executes atomically. Collection-wide bids allow buyers to bid on any NFT in a collection at a specified price.

### AMM Pools
Tensor AMM pools work similarly to sudoswap on Ethereum. A pool creator deposits SOL, NFTs, or both into a pool tied to a specific collection. The pool uses a bonding curve (linear or exponential) to determine prices. As NFTs are bought from the pool, the price increases; as NFTs are sold into the pool, the price decreases.

Pool types:
- **Buy-side pool (Token pool)**: Deposits SOL, buys NFTs from sellers at the curve price.
- **Sell-side pool (NFT pool)**: Deposits NFTs, sells to buyers at the curve price.
- **Two-sided pool (Trade pool)**: Deposits both SOL and NFTs, acts as a market maker earning spread.

### Compressed NFT Support
Compressed NFTs use Solana state compression (concurrent Merkle trees) to store NFT data off-chain while keeping a root hash on-chain. Tensor's TComp program handles proof verification and ownership transfer for cNFTs, making them tradeable with the same UX as standard NFTs.

### Royalty Enforcement
Tensor enforces creator royalties by default. Sellers can opt out on certain collections, but Tensor applies optional royalty enforcement (ORE) where royalties are included in the transaction. Metaplex pNFTs (programmable NFTs) have mandatory royalties that Tensor always respects.

## Architecture

### Program IDs

```
TSwap (Tensorswap):          TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN
TAMMv2 (Tensor AMM v2):      TAMM6ub33ij1mbetoMyVBLeKY5iP41i4UPUJQGkhfsg
TComp (Tensor Compressed):   TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp
TBid (Tensor Bid):           TB1Dqt8JCSqfKRT7ME2aKDBhMBMbCMZa8Lfaeyv6bNg
```

### Key Accounts

- **Pool Account (AMM)**: Stores pool configuration including collection, bonding curve parameters, deposited SOL, and NFT count.
- **Listing Account**: PDA derived from the NFT mint and the TSwap program. Stores price, seller, and expiry.
- **Bid Account**: PDA derived from the bidder and collection. Stores bid amount, quantity, and optional trait filters.
- **Margin Account**: Escrow account that holds SOL for active bids, allowing capital-efficient bidding across collections.

### PDA Derivations

```typescript
// Listing PDA
const [listingPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("listing"), nftMint.toBuffer()],
  TSWAP_PROGRAM_ID
);

// Pool PDA (AMM)
const [poolPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("pool"),
    owner.toBuffer(),
    collectionId.toBuffer(),
    poolIdentifier.toBuffer(),
  ],
  TAMM_PROGRAM_ID
);

// Bid PDA
const [bidPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("bid"), bidder.toBuffer(), bidId.toBuffer()],
  TBID_PROGRAM_ID
);
```

## Integration Guide

### Installation

```bash
npm install @tensor-oss/tensorswap-sdk @coral-xyz/anchor @solana/web3.js
```

### Setting Up the SDK

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TensorSwapSDK,
  TensorAmmSDK,
  computeTakerPrice,
  CurveType,
  PoolType,
} from "@tensor-oss/tensorswap-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = new Wallet(Keypair.fromSecretKey(/* ... */));
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});

const tswapSdk = new TensorSwapSDK({ provider });
const tammSdk = new TensorAmmSDK({ provider });
```

### Listing an NFT

```typescript
async function listNft(
  nftMint: PublicKey,
  price: number // in SOL
) {
  const priceLamports = price * 1e9;

  const { tx } = await tswapSdk.list({
    nftMint,
    nftSource: await getAssociatedTokenAddress(nftMint, wallet.publicKey),
    owner: wallet.publicKey,
    price: priceLamports,
    // Optional: set expiry (Unix timestamp)
    expireInSec: null,
  });

  const sig = await provider.sendAndConfirm(tx);
  console.log("Listed NFT:", sig);
}
```

### Buying a Listed NFT

```typescript
async function buyListedNft(
  nftMint: PublicKey,
  maxPrice: number // in SOL, max you are willing to pay
) {
  const maxPriceLamports = maxPrice * 1e9;

  const { tx } = await tswapSdk.buy({
    nftMint,
    nftBuyerAcc: await getAssociatedTokenAddress(nftMint, wallet.publicKey),
    buyer: wallet.publicKey,
    maxPrice: maxPriceLamports,
    // optionalRoyaltyPct: 100 means full royalties
    optionalRoyaltyPct: 100,
  });

  const sig = await provider.sendAndConfirm(tx);
  console.log("Bought NFT:", sig);
}
```

### Creating an AMM Pool

```typescript
async function createAmmPool(
  collectionMint: PublicKey,
  startingPrice: number, // SOL
  delta: number,         // price change per trade
  depositSol: number     // SOL to deposit
) {
  const config = {
    poolType: PoolType.Trade,
    curveType: CurveType.Linear,
    startingPrice: startingPrice * 1e9,
    delta: delta * 1e9,
    mmCompoundFees: true,
    mmFeeBps: 50, // 0.5% market maker fee
  };

  const { tx, pool } = await tammSdk.initPool({
    owner: wallet.publicKey,
    collectionMint,
    config,
    depositLamports: depositSol * 1e9,
  });

  const sig = await provider.sendAndConfirm(tx);
  console.log("Pool created:", pool.toBase58());
  console.log("Tx:", sig);
}
```

### Placing a Collection Bid

```typescript
async function placeCollectionBid(
  collectionId: PublicKey,
  bidAmount: number, // SOL per NFT
  quantity: number
) {
  const { tx } = await tswapSdk.bid({
    owner: wallet.publicKey,
    amount: bidAmount * 1e9,
    quantity,
    collection: collectionId,
    // Optional: target specific traits
    field: null,
    fieldId: null,
  });

  const sig = await provider.sendAndConfirm(tx);
  console.log("Bid placed:", sig);
}
```

## Common Patterns

### Fetching Active Listings for a Collection

```typescript
// Using Tensor API (recommended for reads)
async function getListings(collectionSlug: string) {
  const response = await fetch(
    `https://api.tensor.so/graphql`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query ActiveListings($slug: String!) {
            activeListings(slug: $slug, sortBy: PriceAsc, limit: 50) {
              txs {
                tx { sellerId grossAmount }
                mint { onchainId name rarityRankHR }
              }
            }
          }
        `,
        variables: { slug: collectionSlug },
      }),
    }
  );
  return response.json();
}
```

### Sniping: Buying the Floor NFT

```typescript
async function snipeFloor(collectionSlug: string, maxPriceSol: number) {
  const listings = await getListings(collectionSlug);
  const cheapest = listings.data.activeListings.txs[0];

  if (!cheapest) throw new Error("No listings found");

  const floorPrice = cheapest.tx.grossAmount / 1e9;
  if (floorPrice > maxPriceSol) {
    throw new Error(`Floor ${floorPrice} SOL exceeds max ${maxPriceSol} SOL`);
  }

  const mint = new PublicKey(cheapest.mint.onchainId);
  await buyListedNft(mint, maxPriceSol);
}
```

### Depositing NFTs into an AMM Pool

```typescript
async function depositNftToPool(pool: PublicKey, nftMint: PublicKey) {
  const { tx } = await tammSdk.depositNft({
    pool,
    owner: wallet.publicKey,
    nftMint,
    nftSource: await getAssociatedTokenAddress(nftMint, wallet.publicKey),
  });

  const sig = await provider.sendAndConfirm(tx);
  console.log("Deposited NFT to pool:", sig);
}
```

## Gotchas and Tips

1. **Taker fees**: Tensor charges ~1.5% on the taker side (buyer for listings, seller for bids). Factor this into price calculations or you will overshoot budgets.

2. **Royalty handling**: pNFTs enforce royalties at the protocol level. For standard NFTs, royalties are optional but Tensor defaults to including them. Always check `optionalRoyaltyPct` in your transactions.

3. **cNFT proofs**: When trading compressed NFTs via TComp, you must provide a valid Merkle proof. Use the DAS (Digital Asset Standard) API to fetch proofs from an RPC that indexes compressed NFTs (Helius, Triton).

4. **AMM slippage**: Pool prices move with each trade. When buying from or selling to an AMM pool, always set a `maxPrice` or `minPrice` to protect against slippage, especially in volatile collections.

5. **Margin accounts**: Tensor supports margin accounts for capital-efficient bidding. Instead of locking SOL per bid, deposit into a margin account and reference it across multiple bids. Be aware that fills reduce your margin balance.

6. **Transaction size**: Complex Tensor transactions (especially cNFT trades with proofs) can be large. Use versioned transactions with lookup tables to stay within Solana's 1232-byte transaction limit.

7. **Collection verification**: Tensor identifies collections by their on-chain collection ID (Metaplex Certified Collection mint or hashlist). Ensure you are referencing the correct collection identifier when placing bids.

8. **Rate limits**: The Tensor GraphQL API has rate limits. For high-frequency reads, consider using on-chain account polling or websocket subscriptions instead.

## Resources

- Tensor App: https://www.tensor.trade
- Tensor API Docs: https://docs.tensor.so
- Tensorswap SDK (GitHub): https://github.com/tensor-foundation/tensorswap-sdk
- Tensor Foundation (GitHub): https://github.com/tensor-foundation
- Tensor Discord: https://discord.gg/tensor
- Metaplex Bubblegum (cNFTs): https://developers.metaplex.com/bubblegum
- Solana State Compression: https://solana.com/docs/advanced/state-compression
