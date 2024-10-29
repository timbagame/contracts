import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { PublicKey, Keypair, SystemProgram, TransactionConfirmationStrategy } from "@solana/web3.js";
import { expect } from "chai";

describe("coinflip", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let configAccount: Keypair;
  let treasury: Keypair;
  let gameToken: Keypair;
  let operator: Keypair;
  let newAuthority: Keypair;
  const feePercentage = 3;

  before(async () => {
    configAccount = Keypair.generate();
    treasury = Keypair.generate();
    gameToken = Keypair.generate();
    operator = Keypair.generate();

    const treasurySignature = await provider.connection.requestAirdrop(treasury.publicKey, 1e9);
    const gameTokenSignature = await provider.connection.requestAirdrop(gameToken.publicKey, 1e9);
    const operatorSignature = await provider.connection.requestAirdrop(operator.publicKey, 1e9);

    await provider.connection.confirmTransaction({
      signature: treasurySignature
    } as TransactionConfirmationStrategy);

    await provider.connection.confirmTransaction({
      signature: gameTokenSignature
    } as TransactionConfirmationStrategy);

    await provider.connection.confirmTransaction({
      signature: operatorSignature
    } as TransactionConfirmationStrategy);
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

    const config = await program.account.programConfig.fetch(configAccount.publicKey);

    expect(config.treasury.toBase58()).to.equal(treasury.publicKey.toBase58());
    expect(config.gameToken.toBase58()).to.equal(gameToken.publicKey.toBase58());
    expect(config.feePercentage.toNumber()).to.equal(feePercentage);
    expect(config.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(config.operator.toBase58()).to.equal(operator.publicKey.toBase58());

    console.log("Config account initialized successfully with the correct data");
  });

  it("updates authority", async () => {
    newAuthority = Keypair.generate();

    await program.methods
      .updateAuthority(newAuthority.publicKey)
      .accounts({
        config: configAccount.publicKey,
      })
      .rpc();

    const config = await program.account.programConfig.fetch(configAccount.publicKey);
    expect(config.authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

    console.log("Authority updated successfully");
  });

  it("updates config fields", async () => {
    const newTreasury = Keypair.generate().publicKey;
    const newGameToken = Keypair.generate().publicKey;
    const newFeePercentage = 5;
    const newOperator = Keypair.generate().publicKey;

    await program.methods
      .updateConfig(
        newTreasury,
        newGameToken,
        new anchor.BN(newFeePercentage),
        newOperator
      )
      .accounts({
        config: configAccount.publicKey,
        authority: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();

    const config = await program.account.programConfig.fetch(configAccount.publicKey);

    expect(config.treasury.toBase58()).to.equal(newTreasury.toBase58());
    expect(config.gameToken.toBase58()).to.equal(newGameToken.toBase58());
    expect(config.feePercentage.toNumber()).to.equal(newFeePercentage);
    expect(config.operator.toBase58()).to.equal(newOperator.toBase58());

    console.log("Config fields updated successfully");
  });
});
