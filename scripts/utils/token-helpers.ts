import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

/**
 * Derive the Associated Token Account (ATA) address for a given wallet + mint.
 * Does NOT create the account — just computes the address.
 */
export function deriveATA(wallet: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, wallet);
}

/**
 * Get or create the ATA for a wallet + mint.
 * If the ATA doesn't exist, the payer creates it.
 */
export async function ensureATA(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  return getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
}

/**
 * Parse a token amount with decimals.
 * e.g., toTokenAmount(1.5, 9) → 1_500_000_000n
 */
export function toTokenAmount(uiAmount: number, decimals: number): bigint {
  return BigInt(Math.round(uiAmount * 10 ** decimals));
}

/**
 * Format a raw token amount to a human-readable string.
 * e.g., fromTokenAmount(1_500_000_000n, 9) → "1.5"
 */
export function fromTokenAmount(raw: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
