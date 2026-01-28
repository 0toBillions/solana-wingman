# Solana Wingman+

An enhanced Solana AI agent skill — teaches program development, **executes on-chain actions**, covers native + Anchor programs, 11 DeFi protocols, and comprehensive security.

Forked from [x4484/solana-wingman](https://github.com/x4484/solana-wingman) and expanded with execution tooling, native SDK modules, expanded DeFi protocol docs, and security content.

## Quick Start

```bash
# 1. Create a new project folder
mkdir my-solana-project
cd my-solana-project

# 2. Install the Solana Wingman skill
npx skills add solana-wingman

# 3. Open in Cursor (or your AI-enabled editor)
cursor .
```

Then tell the AI what you want:

- "Help me build a staking program where users deposit SOL and earn rewards"
- "Create an NFT collection with Metaplex"
- "Send 2 SOL to this address on devnet"
- "Swap USDC for SOL using Jupiter"
- "Check my wallet balance"

## What's New in Wingman+

### Execution Tooling

TypeScript scripts that perform real on-chain Solana operations:

```bash
cd scripts && npm install

# Check your balance
npx ts-node actions/check-balance.ts

# Get devnet SOL
npx ts-node actions/airdrop-devnet.ts 2

# Create a new token
npx ts-node actions/create-token.ts 6

# Swap via Jupiter
npx ts-node actions/swap-jupiter.ts <inputMint> <outputMint> 1.0
```

See [scripts/README.md](scripts/README.md) for all 10 action scripts.

### Expanded Knowledge

| Category | Count | What's New |
|----------|-------|------------|
| Foundations | 11 | +Native programs, Token-2022 extensions, Versioned transactions |
| Protocols | 11 | +Orca, Drift, Kamino, Meteora, Tensor, Jito, Sanctum |
| Security | 2 | +Critical gotchas (10 vulnerability classes) |
| Prompts | 5 | +Execute mode |

### Native Program Development

Write Solana programs without Anchor — raw entrypoints, Borsh serialization, manual account parsing. See `knowledge/foundations/09-native-programs.md`.

### Token-2022 Deep Dive

Transfer fees, hooks, confidential transfers, soulbound tokens, and more. See `knowledge/foundations/10-token-extensions.md`.

## What is Solana Wingman?

A knowledge base and prompt system that helps AI agents assist developers with Solana development:

- **11 Foundations** — Account model, PDAs, CPIs, native programs, token extensions, versioned txns
- **10 Challenges** — Hello Solana through Blinks & Actions
- **11 Protocol Docs** — Jupiter, Raydium, Marinade, MarginFi, Orca, Drift, Kamino, Meteora, Tensor, Jito, Sanctum
- **4 Token Standards** — SPL Token, Token-2022, Metaplex Core, Token Metadata
- **2 Security Modules** — Historical hacks + critical gotchas
- **10 Execution Scripts** — Transfer, swap, deploy, mint, inspect
- **5 Agent Modes** — Build, Audit, Learn, Optimize, Execute

## The Most Important Concept

> **ACCOUNTS ARE EVERYTHING ON SOLANA.**

Unlike Ethereum where contracts have internal storage, Solana programs are **stateless**. All data lives in **accounts** that programs read and write.

## Directory Structure

```
solana-wingman/
├── scripts/                  # Execution tooling
│   ├── actions/              # 10 on-chain action scripts
│   ├── utils/                # Shared helpers (wallet, connection, token)
│   ├── config.ts             # RPC, network, wallet config
│   └── README.md
├── knowledge/
│   ├── challenges/           # 10 Solana-native challenges
│   ├── foundations/          # 11 core concepts
│   ├── gotchas/              # Security gotchas
│   ├── protocols/            # 11 DeFi protocols
│   └── standards/            # 4 token standards
├── tools/
│   ├── anchor/               # Anchor documentation
│   └── security/             # Security checklists
├── prompts/                  # 5 AI modes
├── data/                     # Token/program/protocol addresses
├── skills/                   # skills.sh package
├── AGENTS.md                 # Agent instructions
├── .cursorrules              # Cursor rules
└── skill.json                # Skill metadata
```

## Execution Setup

### Prerequisites

```bash
# Node.js 18+
node --version

# Solana CLI
solana --version

# Set up a wallet (if you don't have one)
solana-keygen new
solana config set --url mainnet-beta
```

### Install & Run Scripts

```bash
cd scripts
npm install

# Check your balance on mainnet
npx ts-node actions/check-balance.ts
```

### Configuration

Set environment variables or create `scripts/.env`:

```env
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
WALLET_PATH=~/.config/solana/id.json
```

## Challenges

| # | Challenge | Concept |
|---|-----------|---------|
| 0 | Hello Solana | First Anchor program, accounts basics |
| 1 | SPL Token | Fungible tokens, ATAs, minting |
| 2 | NFT Metaplex | NFT standard, metadata, collections |
| 3 | PDA Escrow | PDAs, program authority, escrow pattern |
| 4 | Staking | Time-based rewards, deposits/withdrawals |
| 5 | Token-2022 | Transfer hooks, confidential transfers |
| 6 | Compressed NFTs | State compression, Merkle trees |
| 7 | Oracle (Pyth) | Price feeds, staleness checks |
| 8 | AMM Swap | Constant product, liquidity pools |
| 9 | Blinks & Actions | Shareable transactions, unfurling |

## Protocol Coverage

| Protocol | Category | Key Feature |
|----------|----------|-------------|
| Jupiter | DEX Aggregator | Best-price swap routing |
| Raydium | AMM | CLMM + order book hybrid |
| Marinade | Liquid Staking | mSOL, native staking |
| MarginFi | Lending | Isolated risk lending |
| Orca | AMM | Whirlpools CLMM |
| Drift | Perpetuals | Perps, spot, margin |
| Kamino | Lending/Liquidity | kTokens, auto-vaults |
| Meteora | AMM | DLMM, dynamic pools |
| Tensor | NFT Marketplace | NFT AMM, compressed NFTs |
| Jito | MEV/Staking | Bundles, tips, jitoSOL |
| Sanctum | LST Infrastructure | Infinity pool, LST router |

## Critical Security Gotchas

Every Solana developer must know these 10 vulnerability classes:

1. **Missing signer checks** — Unauthorized access to privileged operations
2. **Account ownership validation** — Forged accounts from wrong programs
3. **PDA bump canonicalization** — Non-canonical bumps enable duplicate PDAs
4. **Integer overflow** — Unchecked math enabling fund manipulation
5. **CPI privilege escalation** — Unexpected account passing through CPIs
6. **Reinitialization attacks** — Re-initializing already-set-up accounts
7. **Type cosplay** — Account confusion via discriminator bypass
8. **Closing accounts** — Lamport drain + account reopen attacks
9. **Arbitrary CPI targets** — Calling unvalidated programs
10. **Oracle staleness** — Using stale or manipulated price data

See `knowledge/gotchas/critical-gotchas.md` for code examples.

## Usage Modes

### Build Mode
"Help me build a token staking program" — Scaffold and implement

### Audit Mode
"Review this program for vulnerabilities" — Security review

### Learn Mode
"How do PDAs work?" — Teach concepts with diagrams

### Optimize Mode
"Reduce the compute units of this instruction" — Performance tuning

### Execute Mode
"Send 2 SOL to this address" — On-chain actions via scripts

## Installation

### Via skills.sh (Recommended)

```bash
npx skills add solana-wingman
```

Works with Cursor, Claude Code, Codex, OpenCode, and other AI agents.

### Manual Installation

**For Cursor:** Copy `.cursorrules` to your project root.

**For Claude Code:** Reference `AGENTS.md` in your project instructions.

## Dev Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli

# Node.js (for execution scripts)
# Install via https://nodejs.org (v18+)

# Verify
solana --version
anchor --version
node --version
```

## Contributing

1. Add markdown files to the appropriate directory
2. Follow existing format (TLDR, code examples, security notes)
3. Update `skill.json` if adding new capabilities
4. Test with an AI agent to ensure clarity

## License

MIT License — Use freely for learning and building.

## Credits

Forked from [x4484/solana-wingman](https://github.com/x4484/solana-wingman) by x4484.

Inspired by [ethereum-wingman](https://github.com/austintgriffith/ethereum-wingman) by Austin Griffith.

Built for the Solana developer community. Knowledge sourced from:
- [Solana Docs](https://solana.com/docs)
- [Anchor](https://www.anchor-lang.com/)
- [Metaplex](https://developers.metaplex.com/)
- [Solana Cookbook](https://solanacookbook.com/)
