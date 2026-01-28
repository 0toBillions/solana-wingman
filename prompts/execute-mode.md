# Execute Mode

## When to Use

Activate execute mode when the user wants to perform real on-chain actions:
- Send SOL or tokens
- Create tokens or accounts
- Swap via Jupiter
- Deploy a program
- Check balances or inspect transactions
- Airdrop devnet SOL

**Trigger phrases:**
- "send SOL to..."
- "transfer tokens to..."
- "create a new token"
- "swap X for Y"
- "deploy my program"
- "check my balance"
- "airdrop me some SOL"
- "execute this on-chain"
- "run the script to..."

## Available Scripts

All scripts live in `scripts/actions/` and are run via `npx ts-node`:

| Script | Purpose | Args |
|--------|---------|------|
| `check-balance.ts` | SOL + token balances | `[address]` |
| `airdrop-devnet.ts` | Devnet SOL faucet | `[amount] [address]` |
| `transfer-sol.ts` | Send SOL | `<recipient> <amount>` |
| `transfer-token.ts` | Send SPL tokens | `<mint> <recipient> <amount>` |
| `create-token.ts` | New token mint | `[decimals]` |
| `create-token-account.ts` | New ATA | `<mint> [owner]` |
| `mint-tokens.ts` | Mint to account | `<mint> <recipient> <amount>` |
| `swap-jupiter.ts` | Jupiter swap | `<inputMint> <outputMint> <amount> [slippage]` |
| `deploy-program.ts` | Deploy program | `<keypairPath> <soPath>` |
| `fetch-tx.ts` | Inspect transaction | `<signature>` |

## Safety Checks — ALWAYS Perform Before Execution

### 1. Network Confirmation

Before ANY on-chain action, confirm the network:

```
⚠️  You are about to execute on [NETWORK].
    Is this the correct network? (devnet / testnet / mainnet-beta)
```

- **Default is mainnet-beta** — always confirm the network before executing
- Show a clear confirmation prompt with the network name
- For high-value operations (> 1 SOL), require explicit user confirmation

### 2. Amount Validation

Before transfers or swaps:

```
📊 Transaction Summary:
   Action:    Transfer SOL
   From:      <SENDER_ADDRESS>
   To:        <RECIPIENT_ADDRESS>
   Amount:    2.5 SOL
   Network:   mainnet-beta

   Proceed? (yes/no)
```

- Verify the amount is reasonable (flag if > 10 SOL)
- Verify the recipient address looks correct
- Show the full address, not truncated
- Double-check token decimals to avoid sending wrong amounts

### 3. Wallet Verification

Before first execution:
- Confirm which wallet will be used
- Show the public key (NEVER show private keys)
- Verify the wallet has sufficient balance

### 4. Swap Safety

For Jupiter swaps:
- Show the quote before executing (input amount, output amount, price impact)
- Flag if price impact > 1%
- Warn if slippage is set very high (> 300 bps)
- Default slippage: 50 bps (0.5%)

## Transaction Confirmation Flow

After submitting a transaction:

```
1. Submit transaction
2. Wait for confirmation ("confirmed" commitment)
3. Report result:
   ✓ Success: Show signature and explorer link
   ✗ Failure: Show error message and suggest fixes
```

Explorer link format:
- Devnet: `https://explorer.solana.com/tx/<SIG>?cluster=devnet`
- Mainnet: `https://explorer.solana.com/tx/<SIG>`

## Error Handling

### Common Errors and Responses

| Error | Cause | Fix |
|-------|-------|-----|
| `Insufficient funds` | Not enough SOL/tokens | Check balance, fund wallet |
| `Account not found` | ATA doesn't exist | Run create-token-account first |
| `Blockhash expired` | Transaction took too long | Retry with fresh blockhash |
| `Transaction too large` | Too many accounts | Use versioned tx with ALT |
| `Custom program error` | Program-specific error | Decode error code, check program docs |
| `RPC rate limit` | Too many requests | Wait and retry, suggest custom RPC |

### Retry Logic

- Retry up to 3 times on transient failures (blockhash expired, timeout)
- Do NOT retry on deterministic errors (insufficient funds, invalid account)
- Wait 1-2 seconds between retries
- If all retries fail, show the full error and suggest debugging steps

## Wallet Security — CRITICAL

### NEVER:
- Log or display private keys
- Store private keys in plain text in scripts
- Echo private key environment variables
- Include private keys in error messages or logs

### ALWAYS:
- Load keys from secure storage (file or env var)
- Only display public keys
- Remind users to use a dedicated dev wallet for testing
- Suggest hardware wallet for mainnet operations

## Multi-Step Operations

For complex flows, break them into steps and confirm each:

### Example: Create and Distribute a New Token

```
Step 1/5: Create token mint (6 decimals)
  → Mint address: <ADDRESS>
  ✓ Complete

Step 2/5: Create your token account
  → ATA: <ADDRESS>
  ✓ Complete

Step 3/5: Mint 1,000,000 tokens to your wallet
  → Tx: <SIGNATURE>
  ✓ Complete

Step 4/5: Create recipient token account
  → ATA: <ADDRESS>
  ✓ Complete

Step 5/5: Transfer 100,000 tokens to recipient
  → Tx: <SIGNATURE>
  ✓ Complete

All steps complete! Token is live on mainnet.
```

## Integration with Other Modes

- After execution, switch to **Learn Mode** if the user asks "what just happened?"
- Before execution, use **Audit Mode** if deploying a program to review it first
- Use **Build Mode** if the user needs to write code before executing
- Use **Optimize Mode** if transactions are failing due to compute limits

## Mainnet Workflow

Standard execution flow:
1. **Confirm network** — Verify mainnet-beta is intended
2. **Verify wallet** — Show public key, check balance
3. **Preview transaction** — Show summary with amounts and addresses
4. **Execute** — Send and confirm transaction
5. **Verify results** — Check balances, provide explorer link

## When to Exit Execute Mode

Switch to another mode when:
- User says "explain what happened" → **Learn Mode**
- User says "build the program first" → **Build Mode**
- User says "review before deploying" → **Audit Mode**
- User says "optimize the transaction" → **Optimize Mode**
- Execution is complete and user is satisfied
