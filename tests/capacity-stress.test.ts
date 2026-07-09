import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { TestUtils, TestEnvironment, coinflipGameConfig } from "./test-helpers";

// Ensures large participant sets do not exhaust on-chain Vec capacity

describe("Capacity Stress", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("fills high-capacity games without ParticipantStorageExceeded", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, ...existingPool] = players;

    const maxTickets = 64;
    const ticketAmount = new anchor.BN(1_000_000);

    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
      maxTickets,
      minTickets: 2,
      timeout: 180,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    const neededAdditional = maxTickets - 1;
    const joiners: typeof players = [];
    const reuseCount = Math.min(existingPool.length, neededAdditional);
    joiners.push(...existingPool.slice(0, reuseCount));

    const remaining = neededAdditional - reuseCount;
    if (remaining > 0) {
      const newPlayers = await testUtils.player.createPlayerPool(
        remaining,
        mint.mint
      );
      for (const newcomer of newPlayers) {
        await testUtils.player.fundPlayer(newcomer, mint, ticketAmount);
      }
      joiners.push(...newPlayers);
    }

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    for (const participant of joiners) {
      await testUtils.game.joinGame(gameData.gamePDA, participant.player);
    }

    const finalGame = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(finalGame.ticketsCount).to.equal(maxTickets);
    const expectedTotal = ticketAmount.mul(new anchor.BN(maxTickets));
    expect(new anchor.BN(finalGame.totalAmount.toString()).eq(expectedTotal)).to
      .be.true;
    expect(finalGame.participantHashes.length).to.equal(maxTickets);
  }).timeout(180_000);
});
