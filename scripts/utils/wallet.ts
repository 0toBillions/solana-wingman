import { Keypair } from "@solana/web3.js";
import fs from "fs";
import bs58 from "bs58";
import { WALLET_PATH } from "../config";

/**
 * Load a Keypair from a JSON file (Solana CLI format: array of bytes).
 */
export function loadKeypairFromFile(path: string = WALLET_PATH): Keypair {
  const raw = fs.readFileSync(path, "utf-8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

/**
 * Load a Keypair from a base-58 encoded private key string.
 * Useful when the key is stored in an environment variable.
 */
export function loadKeypairFromBase58(base58Key: string): Keypair {
  const secret = bs58.decode(base58Key);
  return Keypair.fromSecretKey(secret);
}

/**
 * Resolve a keypair from the environment.
 * Checks WALLET_PRIVATE_KEY (base58) first, then falls back to WALLET_PATH file.
 */
export function resolveKeypair(): Keypair {
  const envKey = process.env.WALLET_PRIVATE_KEY;
  if (envKey) {
    return loadKeypairFromBase58(envKey);
  }
  return loadKeypairFromFile();
}
