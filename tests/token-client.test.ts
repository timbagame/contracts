import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
  type Signer,
  type Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountError,
  TokenInvalidAccountSizeError,
  TokenInvalidMintError,
  TokenOwnerOffCurveError,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
  unpackMint,
  unpackTokenAccount,
} from "./token-client.ts";

const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

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
    expect(
      mintTo.keys.map(({ pubkey, isSigner, isWritable }) => ({
        pubkey: pubkey.toBase58(),
        isSigner,
        isWritable,
      })),
    ).to.deep.equal([
      { pubkey: mint.toBase58(), isSigner: false, isWritable: true },
      { pubkey: associatedToken.toBase58(), isSigner: false, isWritable: true },
      { pubkey: payer.toBase58(), isSigner: true, isWritable: false },
    ]);
  });

  it("builds canonical mint-to multisig account metas", () => {
    const mint = NATIVE_MINT;
    const destination = Keypair.generate().publicKey;
    const multisigAuthority = Keypair.generate().publicKey;
    const signer = Keypair.generate();
    const signerPublicKey = Keypair.generate().publicKey;

    const instruction = createMintToInstruction(mint, destination, multisigAuthority, 42n, [
      signer,
      signerPublicKey,
    ]);

    expect(
      instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
        pubkey: pubkey.toBase58(),
        isSigner,
        isWritable,
      })),
    ).to.deep.equal([
      { pubkey: mint.toBase58(), isSigner: false, isWritable: true },
      { pubkey: destination.toBase58(), isSigner: false, isWritable: true },
      { pubkey: multisigAuthority.toBase58(), isSigner: false, isWritable: false },
      { pubkey: signer.publicKey.toBase58(), isSigner: true, isWritable: false },
      { pubkey: signerPublicKey.toBase58(), isSigner: true, isWritable: false },
    ]);
    expect([...instruction.data]).to.deep.equal([7, 42, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("submits mint-to multisig transactions with the payer and multisig members", async () => {
    const payer = Keypair.generate();
    const multisigAuthority = Keypair.generate().publicKey;
    const multiSigners = [Keypair.generate(), Keypair.generate()];
    let submittedTransaction: Transaction | undefined;
    let submittedSigners: Signer[] | undefined;
    const connection = {
      sendTransaction: async (transaction: Transaction, signers: Signer[]) => {
        submittedTransaction = transaction;
        submittedSigners = signers;
        return "synthetic-signature";
      },
      confirmTransaction: async () => ({ value: { err: null } }),
    } as unknown as Connection;

    const signature = await mintTo(
      connection,
      payer,
      NATIVE_MINT,
      Keypair.generate().publicKey,
      multisigAuthority,
      42n,
      multiSigners,
    );

    expect(signature).to.equal("synthetic-signature");
    expect(submittedSigners?.map((signer) => signer.publicKey.toBase58())).to.deep.equal([
      payer.publicKey.toBase58(),
      ...multiSigners.map((signer) => signer.publicKey.toBase58()),
    ]);
    expect(submittedTransaction?.instructions[0].keys.slice(2)).to.deep.include.members([
      { pubkey: multisigAuthority, isSigner: false, isWritable: false },
      ...multiSigners.map((signer) => ({
        pubkey: signer.publicKey,
        isSigner: true,
        isWritable: false,
      })),
    ]);
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

  it("distinguishes classic and Token-2022 mint, token, and multisig account layouts", () => {
    const address = Keypair.generate().publicKey;
    const accountInfo = (data: Buffer, owner = TOKEN_PROGRAM_ID): AccountInfo<Buffer> => ({
      data,
      executable: false,
      lamports: 1,
      owner,
      rentEpoch: 0,
    });

    for (const length of [83, 165, 355]) {
      expect(() =>
        unpackMint(
          address,
          accountInfo(Buffer.alloc(length), TOKEN_2022_PROGRAM_ID),
          TOKEN_2022_PROGRAM_ID,
        ),
      ).to.throw(TokenInvalidAccountSizeError);
    }

    const extendedMint = Buffer.alloc(166);
    extendedMint.writeBigUInt64LE(987n, 36);
    extendedMint[165] = 1;
    expect(
      unpackMint(address, accountInfo(extendedMint, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID)
        .supply,
    ).to.equal(987n);

    const extendedToken = Buffer.alloc(166);
    NATIVE_MINT.toBuffer().copy(extendedToken, 0);
    extendedToken[165] = 2;
    expect(
      unpackTokenAccount(
        address,
        accountInfo(extendedToken, TOKEN_2022_PROGRAM_ID),
        TOKEN_2022_PROGRAM_ID,
      ).mint.equals(NATIVE_MINT),
    ).to.equal(true);

    const wrongExtendedMint = Buffer.from(extendedMint);
    wrongExtendedMint[165] = 2;
    expect(() =>
      unpackMint(
        address,
        accountInfo(wrongExtendedMint, TOKEN_2022_PROGRAM_ID),
        TOKEN_2022_PROGRAM_ID,
      ),
    ).to.throw(TokenInvalidMintError);

    const wrongExtendedToken = Buffer.from(extendedToken);
    wrongExtendedToken[165] = 1;
    expect(() =>
      unpackTokenAccount(
        address,
        accountInfo(wrongExtendedToken, TOKEN_2022_PROGRAM_ID),
        TOKEN_2022_PROGRAM_ID,
      ),
    ).to.throw(TokenInvalidAccountError);
    expect(() =>
      unpackTokenAccount(
        address,
        accountInfo(Buffer.alloc(355), TOKEN_2022_PROGRAM_ID),
        TOKEN_2022_PROGRAM_ID,
      ),
    ).to.throw(TokenInvalidAccountSizeError);
  });
});
