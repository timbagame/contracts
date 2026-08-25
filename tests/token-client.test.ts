import { expect } from "chai";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenOwnerOffCurveError,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  unpackMint,
  unpackTokenAccount,
} from "./token-client.ts";

const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

describe("test token client", () => {
  it("derives canonical associated token addresses and rejects unexpected PDA owners", () => {
    const owner = new PublicKey("11111111111111111111111111111111");
    const pdaOwner = PublicKey.findProgramAddressSync(
      [Buffer.from("owner")],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];

    expect(getAssociatedTokenAddressSync(NATIVE_MINT, owner).toBase58()).to.equal(
      "aqxoAhCwpy3oB1BpNw9hL1HdLYLgPpbPjzxDrrQj3Fs",
    );
    expect(() => getAssociatedTokenAddressSync(NATIVE_MINT, pdaOwner)).to.throw(
      TokenOwnerOffCurveError,
    );
    expect(getAssociatedTokenAddressSync(NATIVE_MINT, pdaOwner, true).toBase58()).to.equal(
      "5myBF2P55TgTd7QW7hYYGZfcqwXDY4rgtLhRF4fJMytm",
    );
  });

  it("builds classic Token and associated-token instructions byte for byte", () => {
    const payer = new PublicKey("11111111111111111111111111111111");
    const mint = NATIVE_MINT;
    const associatedToken = getAssociatedTokenAddressSync(mint, payer);
    const ata = createAssociatedTokenAccountInstruction(payer, associatedToken, payer, mint);
    const initializeMint = createInitializeMint2Instruction(mint, 6, payer, null);
    const mintTo = createMintToInstruction(mint, associatedToken, payer, 0x0102_0304_0506_0708n);

    expect(ata.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).to.equal(true);
    expect([...ata.data]).to.deep.equal([]);
    expect(
      ata.keys.map(({ pubkey, isSigner, isWritable }) => ({
        pubkey: pubkey.toBase58(),
        isSigner,
        isWritable,
      })),
    ).to.deep.equal([
      { pubkey: payer.toBase58(), isSigner: true, isWritable: true },
      { pubkey: associatedToken.toBase58(), isSigner: false, isWritable: true },
      { pubkey: payer.toBase58(), isSigner: false, isWritable: false },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
    ]);
    expect([...initializeMint.data]).to.deep.equal([20, 6, ...payer.toBytes(), 0]);
    expect([...mintTo.data]).to.deep.equal([7, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("decodes only the mint and token-account fields used by the harness", () => {
    const address = new PublicKey("11111111111111111111111111111111");
    const owner = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const mintData = Buffer.alloc(82);
    mintData.writeBigUInt64LE(123_456n, 36);
    const tokenData = Buffer.alloc(165);
    NATIVE_MINT.toBuffer().copy(tokenData, 0);
    owner.toBuffer().copy(tokenData, 32);
    const accountInfo = (data: Buffer): AccountInfo<Buffer> => ({
      data,
      executable: false,
      lamports: 1,
      owner: TOKEN_PROGRAM_ID,
      rentEpoch: 0,
    });

    expect(unpackMint(address, accountInfo(mintData)).supply).to.equal(123_456n);
    expect(unpackTokenAccount(address, accountInfo(tokenData)).mint.equals(NATIVE_MINT)).to.equal(
      true,
    );
    expect(unpackTokenAccount(address, accountInfo(tokenData)).owner.equals(owner)).to.equal(true);
    expect(() => unpackTokenAccount(address, null)).to.throw(TokenAccountNotFoundError);
  });
});
