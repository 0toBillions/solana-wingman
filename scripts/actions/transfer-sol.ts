import {
  SystemProgram,
  Transaction,
  PublicKey,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";

async function main() {
  const [, , recipient, amountStr] = process.argv;
  if (!recipient || !amountStr) {
    console.error("Usage: ts-node actions/transfer-sol.ts <recipient> <amountSOL>");
    process.exit(1);
  }

  const connection = getConnection();
  const payer = resolveKeypair();
  const to = new PublicKey(recipient);
  const lamports = Math.round(parseFloat(amountStr) * LAMPORTS_PER_SOL);

  console.log(`Transferring ${amountStr} SOL to ${to.toBase58()}...`);
  console.log(`From: ${payer.publicKey.toBase58()}`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`✓ Transaction confirmed: ${sig}`);
}

main().catch((err) => {
  console.error("Transfer failed:", err.message);
  process.exit(1);
});
