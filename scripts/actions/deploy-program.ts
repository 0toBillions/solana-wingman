import { execSync } from "child_process";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import { RPC_URL } from "../config";

async function main() {
  const [, , programKeypairPath, soBinaryPath] = process.argv;
  if (!programKeypairPath || !soBinaryPath) {
    console.error(
      "Usage: ts-node actions/deploy-program.ts <programKeypairPath> <soBinaryPath>"
    );
    console.error("");
    console.error("  programKeypairPath — Path to the program keypair JSON");
    console.error("  soBinaryPath       — Path to the compiled .so file");
    console.error("");
    console.error("Example:");
    console.error(
      "  ts-node actions/deploy-program.ts target/deploy/my_program-keypair.json target/deploy/my_program.so"
    );
    process.exit(1);
  }

  if (!fs.existsSync(soBinaryPath)) {
    console.error(`Binary not found: ${soBinaryPath}`);
    console.error("Did you run `anchor build` or `cargo build-sbf`?");
    process.exit(1);
  }

  // Read program ID from keypair
  const raw = fs.readFileSync(programKeypairPath, "utf-8");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  console.log(`Program ID: ${kp.publicKey.toBase58()}`);
  console.log(`Binary:     ${soBinaryPath}`);
  console.log(`RPC:        ${RPC_URL}`);
  console.log("");

  const cmd = `solana program deploy "${soBinaryPath}" --program-id "${programKeypairPath}" --url "${RPC_URL}"`;
  console.log(`Running: ${cmd}\n`);

  try {
    const output = execSync(cmd, { stdio: "inherit" });
    console.log("\n✓ Program deployed successfully");
  } catch {
    console.error("\nDeploy failed. Check output above for details.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});
