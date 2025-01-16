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
    const feePercentage = 1; // 1% fee
    const oracleBufferTime = 300; // 5 minutes in seconds
    const maxPlayers = 100;
    const maxTimeout = 3600; // 1 hour in seconds
    const minTimeout = 300; // 5 minutes in seconds

    // Initialize Oracle
    const tx = await program.methods
      .initializeOracle(
        feePercentage,
        oracleBufferTime,
        maxPlayers,
        maxTimeout,
        minTimeout
      )
      .accounts({
        authority: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    console.log("Oracle initialized with transaction signature:", tx);
  } catch (error) {
    console.error("Error during deployment:", error);
  }
};
