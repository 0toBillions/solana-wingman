import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "../utils/connection";
import { resolveKeypair } from "../utils/wallet";
import { NETWORK } from "../config";

async function main() {
  const connection = getConnection();
  const addressStr = process.argv[2];

  let address: PublicKey;
  if (addressStr) {
    address = new PublicKey(addressStr);
  } else {
    address = resolveKeypair().publicKey;
  }

  console.log(`Network: ${NETWORK}`);
  console.log(`Address: ${address.toBase58()}`);
  console.log("─".repeat(60));

  // SOL balance
  const lamports = await connection.getBalance(address);
  const sol = lamports / LAMPORTS_PER_SOL;
  console.log(`SOL Balance: ${sol.toFixed(9)} SOL (${lamports} lamports)`);

  // Token accounts
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(address, {
    programId: TOKEN_PROGRAM_ID,
  });

  if (tokenAccounts.value.length > 0) {
    console.log(`\nToken Accounts (${tokenAccounts.value.length}):`);
    console.log("─".repeat(60));
    for (const { account, pubkey } of tokenAccounts.value) {
      const data = account.data.parsed.info;
      const mint = data.mint;
      const balance = data.tokenAmount.uiAmountString;
      const decimals = data.tokenAmount.decimals;
      console.log(`  Mint:    ${mint}`);
      console.log(`  ATA:     ${pubkey.toBase58()}`);
      console.log(`  Balance: ${balance} (decimals: ${decimals})`);
      console.log("");
    }
  } else {
    console.log("\nNo SPL token accounts found.");
  }
}

main().catch((err) => {
  console.error("Balance check failed:", err.message);
  process.exit(1);
});
