import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";
import { NETWORK } from "../config";

async function main() {
  if (NETWORK === "mainnet-beta") {
    console.error("Airdrop is not available on mainnet. Use devnet or testnet.");
    process.exit(1);
  }

  const connection = getConnection();
  const amountSOL = parseFloat(process.argv[2] || "2");
  const addressStr = process.argv[3];

  let address: PublicKey;
  if (addressStr) {
    address = new PublicKey(addressStr);
  } else {
    address = resolveKeypair().publicKey;
  }

  const lamports = Math.round(amountSOL * LAMPORTS_PER_SOL);

  console.log(`Requesting ${amountSOL} SOL airdrop on ${NETWORK}...`);
  console.log(`Address: ${address.toBase58()}`);

  const sig = await connection.requestAirdrop(address, lamports);
  console.log(`Airdrop requested: ${sig}`);

  console.log("Confirming...");
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  const balance = await connection.getBalance(address);
  console.log(`✓ Airdrop confirmed. New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error("Airdrop failed:", err.message);
  process.exit(1);
});
