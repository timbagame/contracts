import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Updates bot/ and oracle/ with the latest IDL and program address.
 * - Copies contracts/target/idl/coinflip.json to bot/idl/idl.json and oracle/idl/idl.json
 * - Updates the "address" field within those idl.json files
 * - Updates the address string in bot/idl/idlType.ts and oracle/idl/idlType.ts
 */
async function main() {
  const workspaceRoot = resolve(__dirname, "..", "..");
  const contractsRoot = resolve(__dirname, "..");
  const idlSrc = resolve(contractsRoot, "target", "idl", "coinflip.json");
  const typesSrc = resolve(contractsRoot, "target", "types", "coinflip.ts");
  const anchorToml = resolve(contractsRoot, "Anchor.toml");

  // Determine current program id from Anchor.toml [provider] cluster entry in [programs.*]
  const anchorTomlStr = readFileSync(anchorToml, "utf8");
  const programIdMatch = anchorTomlStr.match(
    /coinflip\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/
  );
  if (!programIdMatch) {
    throw new Error("Could not find coinflip program id in Anchor.toml");
  }
  const programId = programIdMatch[1];

  const targets = [
    resolve(workspaceRoot, "bot", "idl"),
    resolve(workspaceRoot, "oracle", "idl"),
  ];

  const idlJson = JSON.parse(readFileSync(idlSrc, "utf8"));
  // Ensure the IDL address is the new program id
  idlJson.address = programId;

  for (const targetDir of targets) {
    mkdirSync(targetDir, { recursive: true });
    const targetIdlPath = resolve(targetDir, "idl.json");
    writeFileSync(targetIdlPath, JSON.stringify(idlJson, null, 2) + "\n");
  }

  // Update idlType.ts address strings in both bot and oracle
  const idlTypeFiles = [
    resolve(workspaceRoot, "bot", "idl", "idlType.ts"),
    resolve(workspaceRoot, "oracle", "idl", "idlType.ts"),
  ];

  const addressRegex = /(\"address\"\s*:\s*\")[1-9A-HJ-NP-Za-km-z]{32,44}(\")/;

  // Prefer copying fresh generated types if available, else patch existing files
  if (existsSync(typesSrc)) {
    const typesSrcContent = readFileSync(typesSrc, "utf8");
    const patchedTypes = typesSrcContent.replace(
      addressRegex,
      `$1${programId}$2`
    );
    for (const file of idlTypeFiles) {
      try {
        mkdirSync(resolve(file, ".."), { recursive: true });
        writeFileSync(file, patchedTypes);
      } catch (e) {
        // Ignore and continue to next
      }
    }
  } else {
    for (const file of idlTypeFiles) {
      try {
        const src = readFileSync(file, "utf8");
        const updated = src.replace(addressRegex, `$1${programId}$2`);
        if (updated !== src) {
          writeFileSync(file, updated);
        }
      } catch (e) {
        // If idlType.ts doesn't exist yet, skip silently
      }
    }
  }

  // Also update any plain idl.json copies that may exist in bot/oracle already with address field only
  for (const targetDir of targets) {
    const p = resolve(targetDir, "idl.json");
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j.address !== programId) {
        j.address = programId;
        writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
      }
    } catch (_) {}
  }

  const copiedTypes = existsSync(typesSrc);
  console.log(
    `Updated IDL${
      copiedTypes ? " and copied types" : ""
    } and set addresses to ${programId} in bot/ and oracle/.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
