// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@anchor-lang/core";
import * as fs from "fs";
import * as path from "path";

const ORACLE_OPERATOR_KEYPAIR_ENV = "ORACLE_OPERATOR_KEYPAIR_PATH";

const loadKeypairFromFile = (filePath: string): anchor.web3.Keypair => {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const secret = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
};

module.exports = async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Get program from IDL
  const program = anchor.workspace.Timba;

  try {
    // Load oracle operator keypair if provided via env var
    let oracleOperator: anchor.web3.Keypair | undefined;
    const keypairPath = process.env[ORACLE_OPERATOR_KEYPAIR_ENV];

    if (keypairPath && keypairPath.trim().length > 0) {
      try {
        oracleOperator = loadKeypairFromFile(keypairPath.trim());
        console.log(
          `Using oracle operator from ${keypairPath}: ${oracleOperator.publicKey.toBase58()}`
        );
      } catch (err) {
        console.error(
          `Failed to load oracle operator keypair from ${keypairPath}:`,
          err
        );
        throw err;
      }
    } else {
      console.log(
        "No ORACLE_OPERATOR_KEYPAIR_PATH provided. Using deployer wallet as oracle operator."
      );
    }

    // Initialize Oracle parameters
    const config = {
      feePercentage: 1, // 1% fee
      oracleBufferTime: 600, // 10 minutes in seconds
      maxTickets: 100,
      maxTimeout: 86400, // 1 day in seconds
      minTimeout: 300, // 5 minutes in seconds
    };

    const oracleOperatorPubkey =
      oracleOperator?.publicKey ?? provider.wallet.publicKey;

    // Initialize Oracle
    const tx = await program.methods
      .initializeOracle(config)
      .accounts({
        oracleOperator: oracleOperatorPubkey,
        upgradeAuthority: provider.wallet.publicKey,
        programData: anchor.web3.PublicKey.findProgramAddressSync(
          [program.programId.toBuffer()],
          new anchor.web3.PublicKey(
            "BPFLoaderUpgradeab1e11111111111111111111111"
          )
        )[0],
      })
      .signers(oracleOperator ? [oracleOperator] : [])
      .rpc({ commitment: "confirmed" });

    console.log("Oracle initialized with transaction signature:", tx);
  } catch (error) {
    console.error("Error during deployment:", error);
  }
};
