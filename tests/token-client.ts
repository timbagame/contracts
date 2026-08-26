import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Commitment,
  type ConfirmOptions,
  type Connection,
  type Signer,
  type TransactionSignature,
} from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
const MULTISIG_SIZE = 355;
const ACCOUNT_TYPE_MINT = 1;
const ACCOUNT_TYPE_TOKEN = 2;

abstract class TokenError extends Error {}

export class TokenAccountNotFoundError extends TokenError {
  public override readonly name = "TokenAccountNotFoundError";
}

export class TokenInvalidAccountOwnerError extends TokenError {
  public override readonly name = "TokenInvalidAccountOwnerError";
}

export class TokenInvalidAccountSizeError extends TokenError {
  public override readonly name = "TokenInvalidAccountSizeError";
}

export class TokenInvalidAccountError extends TokenError {
  public override readonly name = "TokenInvalidAccountError";
}

export class TokenInvalidMintError extends TokenError {
  public override readonly name = "TokenInvalidMintError";
}

export class TokenInvalidOwnerError extends TokenError {
  public override readonly name = "TokenInvalidOwnerError";
}

export class TokenOwnerOffCurveError extends TokenError {
  public override readonly name = "TokenOwnerOffCurveError";
}

export type TokenAccount = {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
};

export type MintAccount = {
  address: PublicKey;
  supply: bigint;
};

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new TokenOwnerOffCurveError();
  }

  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  )[0];
}

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

export function createInitializeMint2Instruction(
  mint: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const freezeAuthorityData = freezeAuthority
    ? Buffer.concat([Buffer.from([1]), freezeAuthority.toBuffer()])
    : Buffer.from([0]);
  const data = Buffer.concat([
    Buffer.from([20, decimals]),
    mintAuthority.toBuffer(),
    freezeAuthorityData,
  ]);

  return new TransactionInstruction({
    programId,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  });
}

export function createMintToInstruction(
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: number | bigint,
  multiSigners: (Signer | PublicKey)[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 7;
  data.writeBigUInt64LE(BigInt(amount), 1);

  const keys = [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
  ];

  if (multiSigners.length === 0) {
    keys.push({ pubkey: authority, isSigner: true, isWritable: false });
  } else {
    keys.push({ pubkey: authority, isSigner: false, isWritable: false });
    for (const signer of multiSigners) {
      keys.push({
        pubkey: signer instanceof PublicKey ? signer : signer.publicKey,
        isSigner: true,
        isWritable: false,
      });
    }
  }

  return new TransactionInstruction({ programId, keys, data });
}

export function unpackMint(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID,
): MintAccount {
  if (!info) throw new TokenAccountNotFoundError();
  if (!info.owner.equals(programId)) throw new TokenInvalidAccountOwnerError();
  if (info.data.length < MINT_SIZE) throw new TokenInvalidAccountSizeError();
  if (info.data.length > MINT_SIZE) {
    if (info.data.length <= TOKEN_ACCOUNT_SIZE || info.data.length === MULTISIG_SIZE) {
      throw new TokenInvalidAccountSizeError();
    }
    if (info.data[TOKEN_ACCOUNT_SIZE] !== ACCOUNT_TYPE_MINT) {
      throw new TokenInvalidMintError();
    }
  }

  return { address, supply: info.data.readBigUInt64LE(36) };
}

export function unpackTokenAccount(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID,
): TokenAccount {
  if (!info) throw new TokenAccountNotFoundError();
  if (!info.owner.equals(programId)) throw new TokenInvalidAccountOwnerError();
  if (info.data.length < TOKEN_ACCOUNT_SIZE) throw new TokenInvalidAccountSizeError();
  if (info.data.length > TOKEN_ACCOUNT_SIZE) {
    if (info.data.length === MULTISIG_SIZE) throw new TokenInvalidAccountSizeError();
    if (info.data[TOKEN_ACCOUNT_SIZE] !== ACCOUNT_TYPE_TOKEN) {
      throw new TokenInvalidAccountError();
    }
  }

  return {
    address,
    mint: new PublicKey(info.data.subarray(0, 32)),
    owner: new PublicKey(info.data.subarray(32, 64)),
  };
}

export async function createMint(
  connection: Connection,
  payer: Signer,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  decimals: number,
  keypair = Keypair.generate(),
  confirmOptions?: ConfirmOptions,
  programId = TOKEN_PROGRAM_ID,
): Promise<PublicKey> {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: keypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId,
    }),
    createInitializeMint2Instruction(
      keypair.publicKey,
      decimals,
      mintAuthority,
      freezeAuthority,
      programId,
    ),
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, keypair], confirmOptions);
  return keypair.publicKey;
}

export async function getMint(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID,
): Promise<MintAccount> {
  return unpackMint(address, await connection.getAccountInfo(address, commitment), programId);
}

export async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  commitment?: Commitment,
  confirmOptions?: ConfirmOptions,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<TokenAccount> {
  const address = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    programId,
    associatedTokenProgramId,
  );

  let account: TokenAccount;
  try {
    account = unpackTokenAccount(
      address,
      await connection.getAccountInfo(address, commitment),
      programId,
    );
  } catch (error) {
    if (
      !(error instanceof TokenAccountNotFoundError) &&
      !(error instanceof TokenInvalidAccountOwnerError)
    ) {
      throw error;
    }

    try {
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          address,
          owner,
          mint,
          programId,
          associatedTokenProgramId,
        ),
      );
      await sendAndConfirmTransaction(connection, transaction, [payer], confirmOptions);
    } catch {
      // A concurrent transaction may have created the account first.
    }

    account = unpackTokenAccount(
      address,
      await connection.getAccountInfo(address, commitment),
      programId,
    );
  }

  if (!account.mint.equals(mint)) throw new TokenInvalidMintError();
  if (!account.owner.equals(owner)) throw new TokenInvalidOwnerError();
  return account;
}

export async function mintTo(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  destination: PublicKey,
  authority: Signer | PublicKey,
  amount: number | bigint,
  multiSigners: Signer[] = [],
  confirmOptions?: ConfirmOptions,
  programId = TOKEN_PROGRAM_ID,
): Promise<TransactionSignature> {
  const authorityPublicKey = authority instanceof PublicKey ? authority : authority.publicKey;
  const authoritySigners = authority instanceof PublicKey ? multiSigners : [authority];
  const transaction = new Transaction().add(
    createMintToInstruction(mint, destination, authorityPublicKey, amount, multiSigners, programId),
  );
  return sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, ...authoritySigners],
    confirmOptions,
  );
}
