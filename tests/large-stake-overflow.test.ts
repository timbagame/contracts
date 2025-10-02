import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  GameConfig,
  TestEnvironment,
  TestUtils,
  getErrorCode,
} from "./test-helpers";

describe("Large stake overflow regression", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    testUtils = new TestUtils();
  });

  it("rejects joins that would overflow the stake accounting", async () => {
    await testUtils.oracle.createOracle();
    const mint = await testUtils.mint.createMint();
    const players = await testUtils.player.createPlayerPool(4, mint.mint);

    const largeStake = new anchor.BN("6148914691236517205");

    for (const player of players) {
      await testUtils.player.fundPlayer(player, mint, largeStake);
    }

    const gameData = testUtils.game.generateGamePDA();

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: largeStake,
      maxTickets: new anchor.BN(4),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      players[0].player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
    await testUtils.game.joinGame(gameData.gamePDA, players[1].player);
    await testUtils.game.joinGame(gameData.gamePDA, players[2].player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const expectedTotal = largeStake.mul(new anchor.BN(3));
    expect(
      new anchor.BN(gameAccount.totalAmount.toString()).eq(expectedTotal)
    ).to.be.true;

    try {
      await testUtils.game.joinGame(gameData.gamePDA, players[3].player);
      expect.fail("expected overflow join to fail");
    } catch (error) {
      expect(getErrorCode(error)).to.equal("InvalidAmount");
    }
  });
});
