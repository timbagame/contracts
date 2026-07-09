import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  deriveGameAccounts,
  toGameTokenContext,
  coinflipGameConfig,
  getOraclePublicKey,
  expectAnchorError,
} from "./test-helpers";

// Tests for oracle operator update and authority enforcement

describe("Oracle Update Authority", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should gate private joins to the rotated oracle operator", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const ticketAmount = new anchor.BN(1_000_000);
    const config = coinflipGameConfig({
      amount: ticketAmount,
      isPrivate: true,
      maxTickets: 3,
      timeout: 90,
    });

    const gameData = await testUtils.game.createGame(
      config,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(
      gameData.gamePDA,
      creator.player,
      oracle.operatorKeypair
    );

    const candidate = await testUtils.player.createPlayer(mint.mint);
    await testUtils.player.fundPlayer(candidate, mint, ticketAmount);

    const newOperator = anchor.web3.Keypair.generate();
    const connection = env.provider.connection;
    const airdropSig = await connection.requestAirdrop(
      newOperator.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const updateArgs = {
      feePercentage: oracle.config.feePercentage,
      oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
      maxTickets: oracle.config.maxTickets,
      maxTimeout: new anchor.BN(oracle.config.maxTimeout),
      minTimeout: new anchor.BN(oracle.config.minTimeout),
    } as const;

    const updateAccounts = {
      oldOracleOperator: oracle.operator,
      newOracleOperator: newOperator.publicKey,
    } as const;

    await env.program.methods
      .updateOracle(updateArgs)
      .accounts(updateAccounts)
      .signers([oracle.operatorKeypair, newOperator])
      .rpc();

    const restore = async () => {
      await env.program.methods
        .updateOracle(updateArgs)
        .accounts({
          oldOracleOperator: newOperator.publicKey,
          newOracleOperator: oracle.operator,
        })
        .signers([newOperator, oracle.operatorKeypair])
        .rpc();
    };

    try {
      await expectAnchorError(
        testUtils.game.joinGame(
          gameData.gamePDA,
          candidate.player,
          oracle.operatorKeypair
        ),
        "PrivateGameAccessDenied",
        {
          fallbackSubstring: "PrivateGameAccessDenied",
          message: "Old operator should not authorize private join",
        }
      );

      await testUtils.game.joinGame(
        gameData.gamePDA,
        candidate.player,
        newOperator
      );

      const gameAfter = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAfter.ticketsCount).to.equal(2);
    } finally {
      await restore().catch(() => {});
    }
  }).timeout(120000);

  it("should transfer operator and enforce new authority for completion and withdraw", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;

    // Prepare a game to accumulate fees
    const ticketAmount = new anchor.BN(1_000_000);
    const cfg = coinflipGameConfig({
      amount: ticketAmount,
      timeout: 60,
    });
    const gameData = await testUtils.game.createGame(
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

    // Generate a new operator
    const newOperator = anchor.web3.Keypair.generate();

    // Update oracle with old and new signers (they can be distinct)
    await env.program.methods
      .updateOracle({
        feePercentage: oracle.config.feePercentage,
        oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
        maxTickets: oracle.config.maxTickets,
        maxTimeout: new anchor.BN(oracle.config.maxTimeout),
        minTimeout: new anchor.BN(oracle.config.minTimeout),
      })
      .accounts({
        oldOracleOperator: oracle.operator,
        newOracleOperator: newOperator.publicKey,
      })
      .signers([oracle.operatorKeypair, newOperator])
      .rpc();

    // Always restore operator at the end to avoid affecting other suites
    const restore = async () => {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: oracle.config.maxTickets,
          maxTimeout: new anchor.BN(oracle.config.maxTimeout),
          minTimeout: new anchor.BN(oracle.config.minTimeout),
        })
        .accounts({
          oldOracleOperator: newOperator.publicKey,
          newOracleOperator: oracle.operator,
        })
        .signers([newOperator, oracle.operatorKeypair])
        .rpc();
    };

    try {
      const oraclePubkey = getOraclePublicKey(oracle);

      const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
        tokenMint: mint.mint,
      });
      const gameTokenCtx = toGameTokenContext(derived);

      // Old operator should fail to complete
      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.operator, // passing old pubkey
          winnerIndex,
          oracle.operatorKeypair // signer is old operator
        );
        expect.fail("Old operator should not be authorized after update");
      } catch (e: any) {
        const msg = e.toString();
        // Some Anchor versions format as "AnchorError caused by account: oracle ..."
        // Accept either explicit code message or account constraint on oracle
        expect(
          msg.includes("UnauthorizedOperator") ||
            msg.includes("account: oracle")
        ).to.be.true;
      }

      // Complete with new operator using helper (passes minimal accounts)
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        newOperator.publicKey,
        winnerIndex,
        newOperator
      );

      // Accumulated fee withdraw: old operator fails, new operator succeeds
      const spl = await import("@solana/spl-token");
      const newOpAta = await anchor.utils.token.associatedAddress({
        owner: newOperator.publicKey,
        mint: mint.mint,
      });
      // Fund new operator to create ATA if missing
      const airdropSig = await env.provider.connection.requestAirdrop(
        newOperator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await env.provider.connection.confirmTransaction(airdropSig, "confirmed");
      // Create ATA for new operator if missing
      try {
        await env.provider.connection.getTokenAccountBalance(newOpAta);
      } catch {
        const ix = spl.createAssociatedTokenAccountInstruction(
          newOperator.publicKey,
          newOpAta,
          newOperator.publicKey,
          mint.mint
        );
        const tx = new anchor.web3.Transaction().add(ix);
        await env.provider.sendAndConfirm(tx, [newOperator]);
      }

      const oldOperatorAta = await anchor.utils.token.associatedAddress({
        owner: oracle.operator,
        mint: mint.mint,
      });

      // Old operator attempt (minimal accounts subset as per IDL)
      try {
        await env.program.methods
          .withdrawTokenFee()
          .accountsStrict({
            gameTokenCtx,
            oracle: oraclePubkey,
            oracleOperator: oracle.operator,
            oracleOperatorTokenAccount: oldOperatorAta,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([oracle.operatorKeypair])
          .rpc();
        expect.fail("Old operator should not withdraw after transfer");
      } catch (e: any) {
        const msg = e.toString();
        expect(
          msg.includes("UnauthorizedOperator") ||
            msg.includes("account: oracle")
        ).to.be.true;
      }

      // New operator can withdraw remaining fees (possibly zero if no fees after one completion)
      await env.program.methods
        .withdrawTokenFee()
        .accountsStrict({
          gameTokenCtx,
          oracle: oraclePubkey,
          oracleOperator: newOperator.publicKey,
          oracleOperatorTokenAccount: newOpAta,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([newOperator])
        .rpc();
    } finally {
      await restore().catch(() => {});
    }
  }).timeout(120000);
});
