import { PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";

async function main() {
  const [, , mintStr, ownerStr] = process.argv;
  if (!mintStr) {
    console.error("Usage: ts-node actions/create-token-account.ts <mint> [owner]");
    process.exit(1);
  }

  const connection = getConnection();
  const payer = resolveKeypair();
  const mint = new PublicKey(mintStr);
  const owner = ownerStr ? new PublicKey(ownerStr) : payer.publicKey;

  console.log(`Creating token account...`);
  console.log(`  Mint:  ${mint.toBase58()}`);
  console.log(`  Owner: ${owner.toBase58()}`);

  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );

  console.log(`✓ Token account: ${ata.address.toBase58()}`);
  console.log(`  Balance: ${ata.amount.toString()}`);
}

main().catch((err) => {
  console.error("Create token account failed:", err.message);
  process.exit(1);
});
