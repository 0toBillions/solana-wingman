import { Connection } from "@solana/web3.js";
import { RPC_URL, COMMITMENT } from "../config";

let _connection: Connection | null = null;

/**
 * Get a shared Connection instance (singleton).
 * Re-uses the same connection across scripts to avoid unnecessary handshakes.
 */
export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_URL, COMMITMENT);
  }
  return _connection;
}

/**
 * Create a fresh Connection (useful when you need different commitment).
 */
export function createConnection(
  url: string = RPC_URL,
  commitment: string = COMMITMENT
): Connection {
  return new Connection(url, commitment as any);
}
