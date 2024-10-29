import * as anchor from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { Keypair, TransactionConfirmationStrategy } from "@solana/web3.js";
import { expect } from "chai";

describe("initialize_config", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as anchor.Program<Coinflip>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let configAccount: Keypair;
  let treasury: Keypair;
  let gameToken: Keypair;
  let operator: Keypair;

  before(async () => {
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

  beforeEach(() => {
    configAccount = Keypair.generate(); // New config account for each test
  });

  it("should initialize config account with the correct data", async () => {
    const feePercentage = 3;

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

  it("should reject if fee percentage is greater than MAX_FEE_PERCENTAGE", async () => {
    try {
      await program.methods
        .initializeConfig(
          treasury.publicKey,
          gameToken.publicKey,
          new anchor.BN(6), // Fee percentage greater than 5%
          operator.publicKey
        )
        .accounts({
          config: configAccount.publicKey,
          authority: provider.wallet.publicKey,
        })
        .signers([configAccount])
        .rpc();
      expect(false, "Transaction should have failed").to.be.true;
    } catch (err) {
      const error = err as any;
      expect(error.error.errorCode.number).to.equal(6010); // ErrorCode.InvalidFeePercentage
    }
  });

  it("should reject if authority is not the signer", async () => {
    try {
      await program.methods
        .initializeConfig(
          treasury.publicKey,
          gameToken.publicKey,
          new anchor.BN(3),
          operator.publicKey
        )
        .accounts({
          config: configAccount.publicKey,
          authority: Keypair.generate().publicKey, // Different authority
        })
        .signers([configAccount])
        .rpc();
      expect(false, "Transaction should have failed").to.be.true;
    } catch (err) {
      const error = err as any;
      expect(error.error.errorCode.number).to.equal(2001); // AccountOwnerMismatch
    }
  });
});
