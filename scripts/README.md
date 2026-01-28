# Solana Wingman+ Execution Scripts

TypeScript scripts that perform real on-chain Solana operations. Designed for use by AI agents or developers directly from the command line.

## Setup

```bash
cd scripts
npm install
```

Create a `.env` file (optional):

```env
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PATH=~/.config/solana/id.json
# Or provide a base58 private key:
# WALLET_PRIVATE_KEY=your_base58_key_here
```

**Defaults:** devnet network, standard Solana CLI wallet path.

## Scripts

### Check Balance

```bash
npx ts-node actions/check-balance.ts [address]
```

Shows SOL balance and all SPL token accounts. Omit address to use your default wallet.

### Airdrop (Devnet/Testnet Only)

```bash
npx ts-node actions/airdrop-devnet.ts [amountSOL] [address]
```

Request SOL from the faucet. Defaults to 2 SOL to your wallet. Blocked on mainnet.

### Transfer SOL

```bash
npx ts-node actions/transfer-sol.ts <recipient> <amountSOL>
```

Send SOL to any address.

### Transfer SPL Tokens

```bash
npx ts-node actions/transfer-token.ts <mint> <recipient> <amount>
```

Send SPL tokens. Automatically creates the recipient's Associated Token Account if needed.

### Create Token Mint

```bash
npx ts-node actions/create-token.ts [decimals]
```

Create a new SPL token mint. Decimals default to 9 (like SOL).

### Create Token Account

```bash
npx ts-node actions/create-token-account.ts <mint> [owner]
```

Create an Associated Token Account. Owner defaults to the payer wallet.

### Mint Tokens

```bash
npx ts-node actions/mint-tokens.ts <mint> <recipient> <amount>
```

Mint tokens to a recipient. Your wallet must be the mint authority.

### Swap via Jupiter

```bash
npx ts-node actions/swap-jupiter.ts <inputMint> <outputMint> <amount> [slippageBps]
```

Swap tokens using the Jupiter aggregator. Slippage defaults to 50 bps (0.5%).

### Deploy Program

```bash
npx ts-node actions/deploy-program.ts <programKeypairPath> <soBinaryPath>
```

Deploy an Anchor/native Solana program. Wraps `solana program deploy`.

### Fetch Transaction

```bash
npx ts-node actions/fetch-tx.ts <signature>
```

Fetch and decode a transaction by signature. Shows slot, fee, status, instructions, and logs.

## Quick Start Example

```bash
# 1. Get some devnet SOL
npx ts-node actions/airdrop-devnet.ts 2

# 2. Check your balance
npx ts-node actions/check-balance.ts

# 3. Create a new token
npx ts-node actions/create-token.ts 6

# 4. Mint some tokens (use the mint address from step 3)
npx ts-node actions/mint-tokens.ts <MINT_ADDRESS> <YOUR_ADDRESS> 1000

# 5. Check balance again to see your tokens
npx ts-node actions/check-balance.ts
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_NETWORK` | `devnet` | Cluster: `devnet`, `testnet`, or `mainnet-beta` |
| `SOLANA_RPC_URL` | Cluster default | Custom RPC endpoint |
| `WALLET_PATH` | `~/.config/solana/id.json` | Path to keypair JSON |
| `WALLET_PRIVATE_KEY` | — | Base58 private key (overrides file) |

## Security Notes

- **Never commit private keys** to version control
- **Never log private keys** — scripts only log public keys
- **Use devnet** for testing before mainnet
- **Review transactions** before signing on mainnet
- The `.env` file is gitignored by default
