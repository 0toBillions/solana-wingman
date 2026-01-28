import {
  PublicKey,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";
import { toTokenAmount } from "../utils/token-helpers";
import { JUPITER_API_URL } from "../config";

async function main() {
  const [, , inputMintStr, outputMintStr, amountStr, slippageStr] = process.argv;
  if (!inputMintStr || !outputMintStr || !amountStr) {
    console.error(
      "Usage: ts-node actions/swap-jupiter.ts <inputMint> <outputMint> <amount> [slippageBps]"
    );
    process.exit(1);
  }

  const connection = getConnection();
  const payer = resolveKeypair();
  const inputMint = new PublicKey(inputMintStr);
  const outputMint = new PublicKey(outputMintStr);
  const slippageBps = parseInt(slippageStr || "50", 10);
  const amount = parseFloat(amountStr);

  // Resolve input decimals
  const mintInfo = await getMint(connection, inputMint);
  const rawAmount = toTokenAmount(amount, mintInfo.decimals);

  console.log(`Swapping ${amount} of ${inputMint.toBase58()} → ${outputMint.toBase58()}`);
  console.log(`Slippage: ${slippageBps} bps`);

  // 1. Get quote
  const quoteUrl = new URL(`${JUPITER_API_URL}/quote`);
  quoteUrl.searchParams.set("inputMint", inputMint.toBase58());
  quoteUrl.searchParams.set("outputMint", outputMint.toBase58());
  quoteUrl.searchParams.set("amount", rawAmount.toString());
  quoteUrl.searchParams.set("slippageBps", slippageBps.toString());

  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) {
    throw new Error(`Jupiter quote failed: ${await quoteRes.text()}`);
  }
  const quote = await quoteRes.json();

  console.log(`Quote received — estimated out: ${quote.outAmount}`);

  // 2. Get swap transaction
  const swapRes = await fetch(`${JUPITER_API_URL}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: payer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });

  if (!swapRes.ok) {
    throw new Error(`Jupiter swap failed: ${await swapRes.text()}`);
  }

  const { swapTransaction } = await swapRes.json();

  // 3. Deserialize, sign, send
  const txBuf = Buffer.from(swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([payer]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, "confirmed");
  console.log(`✓ Swap confirmed: ${sig}`);
}

main().catch((err) => {
  console.error("Swap failed:", err.message);
  process.exit(1);
});
