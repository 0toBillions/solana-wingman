import { Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";

async function main() {
  const decimals = parseInt(process.argv[2] || "9", 10);

  const connection = getConnection();
  const payer = resolveKeypair();
  const mintKeypair = Keypair.generate();

  console.log(`Creating token mint with ${decimals} decimals...`);
  console.log(`Payer / Mint Authority: ${payer.publicKey.toBase58()}`);

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,  // mint authority
    payer.publicKey,  // freeze authority (set null to disable)
    decimals,
    mintKeypair
  );

  console.log(`✓ Token mint created: ${mint.toBase58()}`);
  console.log(`  Decimals:        ${decimals}`);
  console.log(`  Mint authority:  ${payer.publicKey.toBase58()}`);
  console.log(`  Freeze authority: ${payer.publicKey.toBase58()}`);
}

main().catch((err) => {
  console.error("Create token failed:", err.message);
  process.exit(1);
});
