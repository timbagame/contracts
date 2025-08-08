import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

/**
 * Copies generated IDL and types from contracts to bot/ and oracle/.
 * - contracts/target/idl/coinflip.json -> bot/idl/idl.json and oracle/idl/idl.json
 * - contracts/target/types/coinflip.ts -> bot/idl/idlType.ts and oracle/idl/idlType.ts
 * No patching or address rewriting is performed.
 */
async function main() {
  const workspaceRoot = resolve(__dirname, "..", "..");
  const contractsRoot = resolve(__dirname, "..");

  const idlSrc = resolve(contractsRoot, "target", "idl", "coinflip.json");
  const typesSrc = resolve(contractsRoot, "target", "types", "coinflip.ts");

  // Read sources (throws if not generated yet)
  const idlContent = readFileSync(idlSrc, "utf8");
  const typesContent = readFileSync(typesSrc, "utf8");

  const targets = [
    resolve(workspaceRoot, "bot", "idl"),
    resolve(workspaceRoot, "oracle", "idl"),
  ];

  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "idl.json"), idlContent);
    writeFileSync(resolve(dir, "idlType.ts"), typesContent);
  }

  console.log("Copied IDL and types to bot/idl and oracle/idl.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
