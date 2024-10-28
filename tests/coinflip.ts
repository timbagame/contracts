import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("coinflip", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let configAccount: Keypair;
  let treasury: Keypair;
  let gameToken: Keypair;
  let operator: Keypair;
  const feePercentage = 3; // Example value below MAX_FEE_PERCENTAGE

  before(async () => {
    // Generate new Keypairs for config, treasury, game token, and operator.
    configAccount = Keypair.generate();
    treasury = Keypair.generate();
    gameToken = Keypair.generate();
    operator = Keypair.generate();

    // Airdrop some SOL to these accounts to cover fees.
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(treasury.publicKey, 1e9)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(gameToken.publicKey, 1e9)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(operator.publicKey, 1e9)
    );
  });

  it("initializes config account", async () => {
    await program.methods
      .initializeConfig(
        treasury.publicKey,
        gameToken.publicKey,
        new anchor.BN(feePercentage),
        operator.publicKey
      )
      .accounts({
        config: configAccount.publicKey,
        authority: provider.wallet.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Fetch the account to check if initialized correctly.
    const config = await program.account.programConfig.fetch(configAccount.publicKey);

    // Verify account data matches expected values.
    expect(config.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(config.gameToken.toBase58()).to.equal(gameToken.publicKey.toBase58());
    expect(config.feePercentage.toNumber()).to.equal(feePercentage);
    expect(config.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(config.operator.toBase58()).to.equal(operator.publicKey.toBase58());

    console.log("Config account initialized successfully with the correct data");
  });
});
