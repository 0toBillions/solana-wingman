import { getConnection } from "../utils/connection";
import { NETWORK } from "../config";

async function main() {
  const [, , signature] = process.argv;
  if (!signature) {
    console.error("Usage: ts-node actions/fetch-tx.ts <signature>");
    process.exit(1);
  }

  const connection = getConnection();

  console.log(`Fetching transaction on ${NETWORK}...`);
  console.log(`Signature: ${signature}\n`);

  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    console.error("Transaction not found. It may still be processing or the signature is invalid.");
    process.exit(1);
  }

  // Basic info
  console.log("─".repeat(60));
  console.log(`Slot:           ${tx.slot}`);
  console.log(`Block Time:     ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "N/A"}`);
  console.log(`Fee:            ${tx.meta?.fee} lamports`);
  console.log(`Status:         ${tx.meta?.err ? "FAILED" : "SUCCESS"}`);
  if (tx.meta?.err) {
    console.log(`Error:          ${JSON.stringify(tx.meta.err)}`);
  }
  console.log(`Compute Units:  ${tx.meta?.computeUnitsConsumed ?? "N/A"}`);

  // Signers
  const signers = tx.transaction.message.accountKeys
    .filter((k: any) => k.signer)
    .map((k: any) => k.pubkey.toBase58());
  console.log(`\nSigners (${signers.length}):`);
  signers.forEach((s: string) => console.log(`  ${s}`));

  // Instructions
  const instructions = tx.transaction.message.instructions;
  console.log(`\nInstructions (${instructions.length}):`);
  for (const ix of instructions) {
    if ("parsed" in ix) {
      console.log(`  Program: ${ix.program}`);
      console.log(`  Type:    ${ix.parsed.type}`);
      console.log(`  Info:    ${JSON.stringify(ix.parsed.info, null, 2)}`);
    } else {
      console.log(`  Program: ${ix.programId.toBase58()}`);
      console.log(`  Data:    ${ix.data}`);
    }
    console.log("");
  }

  // Log messages
  if (tx.meta?.logMessages?.length) {
    console.log("Log Messages:");
    for (const log of tx.meta.logMessages) {
      console.log(`  ${log}`);
    }
  }
}

main().catch((err) => {
  console.error("Fetch failed:", err.message);
  process.exit(1);
});
