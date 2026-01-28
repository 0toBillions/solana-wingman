import { PublicKey } from "@solana/web3.js";
import { mintTo, getMint } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";
import { ensureATA, toTokenAmount } from "../utils/token-helpers";

async function main() {
  const [, , mintStr, recipientStr, amountStr] = process.argv;
  if (!mintStr || !recipientStr || !amountStr) {
    console.error("Usage: ts-node actions/mint-tokens.ts <mint> <recipient> <amount>");
    process.exit(1);
  }

  const connection = getConnection();
  const authority = resolveKeypair();
  const mint = new PublicKey(mintStr);
  const recipient = new PublicKey(recipientStr);
  const amount = parseFloat(amountStr);

  const mintInfo = await getMint(connection, mint);
  const rawAmount = toTokenAmount(amount, mintInfo.decimals);

  const recipientATA = await ensureATA(connection, authority, mint, recipient);

  console.log(`Minting ${amount} tokens...`);
  console.log(`  Mint:      ${mint.toBase58()}`);
  console.log(`  To:        ${recipientATA.address.toBase58()}`);
  console.log(`  Authority: ${authority.publicKey.toBase58()}`);

  const sig = await mintTo(
    connection,
    authority,
    mint,
    recipientATA.address,
    authority,
    rawAmount
  );

  console.log(`✓ Minted ${amount} tokens: ${sig}`);
}

main().catch((err) => {
  console.error("Mint failed:", err.message);
  process.exit(1);
});
