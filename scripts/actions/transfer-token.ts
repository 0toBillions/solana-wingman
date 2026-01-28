import { PublicKey } from "@solana/web3.js";
import { transfer, getMint } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";
import { deriveATA, ensureATA, toTokenAmount } from "../utils/token-helpers";

async function main() {
  const [, , mintStr, recipientStr, amountStr] = process.argv;
  if (!mintStr || !recipientStr || !amountStr) {
    console.error("Usage: ts-node actions/transfer-token.ts <mint> <recipient> <amount>");
    process.exit(1);
  }

  const connection = getConnection();
  const payer = resolveKeypair();
  const mint = new PublicKey(mintStr);
  const recipient = new PublicKey(recipientStr);
  const amount = parseFloat(amountStr);

  const mintInfo = await getMint(connection, mint);
  const rawAmount = toTokenAmount(amount, mintInfo.decimals);

  const senderATA = deriveATA(payer.publicKey, mint);
  const recipientAccount = await ensureATA(connection, payer, mint, recipient);

  console.log(`Transferring ${amount} tokens (mint: ${mint.toBase58()})...`);
  console.log(`From ATA: ${senderATA.toBase58()}`);
  console.log(`To ATA:   ${recipientAccount.address.toBase58()}`);

  const sig = await transfer(
    connection,
    payer,
    senderATA,
    recipientAccount.address,
    payer,
    rawAmount
  );

  console.log(`✓ Token transfer confirmed: ${sig}`);
}

main().catch((err) => {
  console.error("Token transfer failed:", err.message);
  process.exit(1);
});
