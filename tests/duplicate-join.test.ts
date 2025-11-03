import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  expectAnchorError,
  deriveGameAccounts,
  toGameTokenContext,
  errorToString,
} from "./test-helpers";

// Tests duplicate join prevention using bloom + hash exact list

describe("Duplicate Join Prevention", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should prevent duplicate join with AlreadyJoined error", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const gameConfig = coinflipGameConfig({
      timeout: 600,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    await expectAnchorError(
      testUtils.game.joinGame(gameData.gamePDA, creator.player),
      "AlreadyJoined",
      {
        fallbackSubstring: "AlreadyJoined",
        message: "Expected duplicate join to fail",
      }
    );
  });

  it("should reject multiple final-seat joins queued in one transaction", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, firstParticipant] = players;

    const ticketAmount = new anchor.BN(1_000_000);
    const cfg = coinflipGameConfig({
      amount: ticketAmount,
      maxTickets: 3,
      minTickets: 2,
      timeout: 90,
    });

    const gameData = await testUtils.game.createGame(
      cfg,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, firstParticipant.player);

    const second = await testUtils.player.createPlayer(mint.mint);
    const third = await testUtils.player.createPlayer(mint.mint);
    await testUtils.player.fundPlayer(second, mint, ticketAmount);
    await testUtils.player.fundPlayer(third, mint, ticketAmount);

    const buildJoinIx = async (entrant: typeof second) => {
      const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
        player: entrant.player.publicKey,
        tokenMint: mint.mint,
      });
      if (!derived.playerTokenAccount) {
        throw new Error("Missing player ATA for queued join");
      }

      return env.program.methods
        .joinGame()
        .accounts({
          game: gameData.gamePDA,
          player: entrant.player.publicKey,
          oracle: derived.oracle,
          gameTokenCtx: toGameTokenContext(derived),
          playerTokenAccount: derived.playerTokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .instruction();
    };

    const tx = new anchor.web3.Transaction();
    tx.feePayer = env.provider.wallet.publicKey;
    tx.add(await buildJoinIx(second), await buildJoinIx(third));

    try {
      await env.provider.sendAndConfirm(tx, [second.player, third.player]);
      expect.fail("Queued final seat joins should fail with GameFull");
    } catch (error: unknown) {
      expect(errorToString(error)).to.include("Game full");
    }

    const gameAfter = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAfter.ticketsCount).to.equal(2);
  }).timeout(120000);
});
