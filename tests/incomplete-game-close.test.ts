import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Tests closing a game after timeout when min tickets not reached and players unjoin

describe("Incomplete Game Close", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should allow players to unjoin after buffer then creator closes game", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1, p2] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(5),
      minTickets: new anchor.BN(4), // Will not reach
      timeout: new anchor.BN(5), // short
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    // Wait timeout + buffer for unjoin eligibility
    const bufferSecs = oracle.config.oracleBufferTime as number; // 2 by default
    await new Promise((r) => setTimeout(r, (5 + bufferSecs + 2) * 1000));

    // Unjoin all players
    for (const pl of [creator, p1, p2]) {
      await testUtils.game.unjoinGame(gameData.gamePDA, pl.player, 0);
    }

    const gameAfterUnjoins = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameAfterUnjoins.ticketsCount).to.equal(0);
    expect(gameAfterUnjoins.totalAmount.toNumber()).to.equal(0);

    // Close game (refund not applicable since not giveaway)
    await env.program.methods
      .closeGame()
      .accounts({
        creator: creator.player.publicKey,
        game: gameData.gamePDA,
        oracle: (await env.program.account.oracle.all())[0].publicKey,
        gameToken: mint.gameTokenPDA,
        gameVault: testUtils.mint.getGameVaultPDA(mint.mint),
        creatorTokenAccount: creator.playerTokenAccount.address,
        gameTokenAccount: await anchor.utils.token.associatedAddress({ owner: testUtils.mint.getGameVaultPDA(mint.mint), mint: mint.mint }),
      })
      .signers([creator.player])
      .rpc();
  }).timeout(60000);
});
