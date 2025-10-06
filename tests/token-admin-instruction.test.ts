import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Timba } from "../target/types/timba";
import { MintManager, TestEnvironment } from "./test-helpers";

// Instruction coverage for initialize_token and update_token flows

type TimbaEvents = anchor.IdlEvents<Timba>;
type TimbaEventName = keyof TimbaEvents;

describe("Token Administration Instructions", () => {
  let env: TestEnvironment;
  let mintManager: MintManager;

  const subscribeEvent = async <TEvent extends TimbaEventName>(
    eventName: TEvent
  ) => {
    let listenerId: number | undefined;
    let settled = false;
    let resolveEvent: (value: TimbaEvents[TEvent]) => void;
    let rejectEvent: (reason?: unknown) => void;

    const wait = new Promise<TimbaEvents[TEvent]>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectEvent(new Error(`${eventName} timeout`));
      }
    }, 10000);

    listenerId = await env.program.addEventListener(
      eventName,
      (event: TimbaEvents[TEvent]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveEvent(event);
      }
    );

    const dispose = async () => {
      clearTimeout(timer);
      if (listenerId !== undefined) {
        await env.program.removeEventListener(listenerId);
      }
    };

    wait.catch(async () => {
      await dispose().catch(() => {});
    });

    return { wait, dispose };
  };

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    // Use standalone MintManager so tests can mint without touching global helpers
    mintManager = new MintManager(env.program, env.provider);
  });

  it("should emit TokenInitialized event with expected payload", async () => {
    const subscription = await subscribeEvent("tokenInitialized");
    try {
      const mint = await mintManager.createMint();

      const event = await subscription.wait;
      const gameTokenAccount = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );

      const expectedMinAmount = gameTokenAccount.minAmount.toNumber();

      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(Number(event.minAmount)).to.equal(expectedMinAmount);
      expect(event.enabled).to.equal(true);

      expect(gameTokenAccount.tokenMint.equals(mint.mint)).to.be.true;
      expect(gameTokenAccount.minAmount.toNumber()).to.equal(expectedMinAmount);
      expect(gameTokenAccount.enabled).to.equal(true);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should reject initialize_token when caller is not oracle operator", async () => {
    const connection = env.provider.connection;

    const fakeOperator = anchor.web3.Keypair.generate();
    const mintAuthority = anchor.web3.Keypair.generate();

    // Fund fake operator and mint authority for rent/fees
    const airdrops = await Promise.all([
      connection.requestAirdrop(
        fakeOperator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      connection.requestAirdrop(
        mintAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
    ]);
    await Promise.all(
      airdrops.map((sig) => connection.confirmTransaction(sig, "confirmed"))
    );

    const mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      env.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      env.program.programId
    );

    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      fakeOperator,
      mint,
      gameVaultPDA,
      true
    );

    try {
      await env.program.methods
        .initializeToken({ minAmount: new anchor.BN(10_000), enabled: true })
        .accountsStrict({
          gameToken: gameTokenPDA,
          tokenMint: mint,
          gameVault: gameVaultPDA,
          gameTokenAccount: vaultAta.address,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: fakeOperator.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fakeOperator])
        .rpc();
      expect.fail("Expected initialize_token to reject unauthorized operator");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });

  it("should reject update_token when signer is not oracle operator", async () => {
    const mint = await mintManager.createMint();
    const fakeOperator = anchor.web3.Keypair.generate();

    const connection = env.provider.connection;
    const sig = await connection.requestAirdrop(
      fakeOperator.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await env.program.methods
        .updateToken({ minAmount: new anchor.BN(99_999), enabled: false })
        .accountsStrict({
          gameToken: mint.gameTokenPDA,
          tokenMint: mint.mint,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: fakeOperator.publicKey,
        })
        .signers([fakeOperator])
        .rpc();
      expect.fail("Expected update_token to reject unauthorized operator");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });

  it("should emit TokenUpdated when configuration changes", async () => {
    const mint = await mintManager.createMint();
    const subscription = await subscribeEvent("tokenUpdated");

    const newMinAmount = new anchor.BN(42_000);

    try {
      await env.program.methods
        .updateToken({ minAmount: newMinAmount, enabled: false })
        .accounts({
          tokenMint: mint.mint,
          oracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc();

      const event = await subscription.wait;
      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(Number(event.minAmount)).to.equal(newMinAmount.toNumber());
      expect(event.enabled).to.equal(false);

      const onChain = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(onChain.minAmount.toNumber()).to.equal(newMinAmount.toNumber());
      expect(onChain.enabled).to.equal(false);
    } finally {
      await subscription.dispose().catch(() => {});

      await env.program.methods
        .updateToken({ minAmount: new anchor.BN(1000), enabled: true })
        .accounts({
          tokenMint: mint.mint,
          oracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc();
    }
  });
});
