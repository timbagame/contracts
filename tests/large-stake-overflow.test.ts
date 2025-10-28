import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestEnvironment,
  TestUtils,
  getErrorCode,
  coinflipGameConfig,
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

    const gameConfig = coinflipGameConfig({
      amount: largeStake,
      maxTickets: 4,
      minTickets: 2,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      players[0].player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
    await testUtils.game.joinGame(gameData.gamePDA, players[1].player);
    await testUtils.game.joinGame(gameData.gamePDA, players[2].player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const expectedTotal = largeStake.mul(new anchor.BN(3));
    expect(new anchor.BN(gameAccount.totalAmount.toString()).eq(expectedTotal))
      .to.be.true;

    try {
      await testUtils.game.joinGame(gameData.gamePDA, players[3].player);
      expect.fail("expected overflow join to fail");
    } catch (error) {
      expect(getErrorCode(error)).to.equal("InsufficientBalance");
    }
  });
});
