import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from 'chai';

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;

  it("Initialize Config Successfully", async () => {
    // Generate a new keypair for treasury
    const treasury = anchor.web3.Keypair.generate().publicKey;
    // Set fee percentage (e.g., 1%)
    const feePercentage = new BN(1);
    // Use provider's wallet as operator
    const operator = program.provider.publicKey;
    // Create a new keypair for the config account
    const configAccount = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .initializeConfig(treasury, feePercentage, operator)
      .accounts({
        config: configAccount.publicKey,
      })
      .signers([configAccount])
      .rpc();
    
    console.log("Your transaction signature", tx);

    // Fetch the created config account
    const configData = await program.account.config.fetch(configAccount.publicKey);

    // Verify the config was initialized with correct values
    expect(configData.treasury.toString()).to.equal(treasury.toString());
    expect(configData.feePercentage.toString()).to.equal(feePercentage.toString());
    expect(configData.operator.toString()).to.equal(operator.toString());
  });
});