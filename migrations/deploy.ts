// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Get program from IDL
  const program = anchor.workspace.Coinflip;

  try {
    // Initialize Oracle parameters
    const config = {
      feePercentage: 1, // 1% fee
      oracleBufferTime: 300, // 5 minutes in seconds
      maxPlayers: 1000000,
      maxTimeout: 86400, // 1 day in seconds
      minTimeout: 60, // 1 minute in seconds
    };

    // Initialize Oracle
    const tx = await program.methods
      .initializeOracle(config)
      .accounts({
        authority: provider.wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Oracle initialized with transaction signature:", tx);
  } catch (error) {
    console.error("Error during deployment:", error);
  }
};
