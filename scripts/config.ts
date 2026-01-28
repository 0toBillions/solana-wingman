import "dotenv/config";
import { Cluster, clusterApiUrl } from "@solana/web3.js";

/**
 * Central configuration for all Solana Wingman scripts.
 *
 * Environment variables (set in .env or shell):
 *   SOLANA_NETWORK  — "devnet" | "testnet" | "mainnet-beta"  (default: mainnet-beta)
 *   SOLANA_RPC_URL  — Custom RPC endpoint (overrides network default)
 *   WALLET_PATH     — Path to keypair JSON file (default: ~/.config/solana/id.json)
 */

export const NETWORK: Cluster =
  (process.env.SOLANA_NETWORK as Cluster) || "mainnet-beta";

export const RPC_URL: string =
  process.env.SOLANA_RPC_URL || clusterApiUrl(NETWORK);

export const WALLET_PATH: string =
  process.env.WALLET_PATH ||
  `${process.env.HOME || process.env.USERPROFILE}/.config/solana/id.json`;

export const COMMITMENT = "confirmed" as const;

/** Jupiter API base URL */
export const JUPITER_API_URL = "https://quote-api.jup.ag/v6";

/** Wrapped SOL mint */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
