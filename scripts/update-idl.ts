import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

/**
 * Copies generated IDL and types to every production consumer.
 * No patching or address rewriting is performed.
 */
async function main() {
  const workspaceRoot = resolve(__dirname, "..", "..");
  const contractsRoot = resolve(__dirname, "..");

  const idlSrc = resolve(contractsRoot, "target", "idl", "timba.json");
  const typesSrc = resolve(contractsRoot, "target", "types", "timba.ts");

  // Read sources (throws if not generated yet)
  const idlContent = readFileSync(idlSrc, "utf8");
  const typesContent = readFileSync(typesSrc, "utf8");

  const targets = [
    resolve(workspaceRoot, "bot", "idl"),
    resolve(workspaceRoot, "oracle", "idl"),
    resolve(workspaceRoot, "timba-web-cf", "lib", "solana"),
  ];

  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "idl.json"), idlContent);
    writeFileSync(resolve(dir, "idlType.ts"), typesContent);
  }

  console.log("Copied IDL and types to bot, oracle, and web clients.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
