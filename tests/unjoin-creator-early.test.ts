import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  getClockUnixTimestamp,
  toNumber,
} from "./test-helpers";

// Demonstrates that the creator can unjoin another player before min tickets are reached.

describe("Creator Unjoin Before Min Tickets", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("allows creator authority to unjoin a participant before min tickets", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, participant] = players;

    const ticketAmount = new anchor.BN(1_200_000);
    const timeoutSeconds = 60;
    const minTickets = 3;

    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
      maxTickets: 5,
      minTickets,
      timeout: timeoutSeconds,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(2);
    expect(toNumber(gameAccount.minTickets)).to.equal(minTickets);

    const now = await getClockUnixTimestamp(env.provider.connection);
    const timeoutAt = toNumber(gameAccount.createdAt) + timeoutSeconds;
    expect(now).to.be.lessThan(timeoutAt);

    const balanceBefore = await env.provider.connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    await testUtils.game.unjoinGame(
      gameData.gamePDA,
      participant.player,
      creator.player
    );

    const balanceAfter = await env.provider.connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    const received = new anchor.BN(balanceAfter.value.amount).sub(
      new anchor.BN(balanceBefore.value.amount)
    );
    expect(received.eq(ticketAmount)).to.be.true;

    const updated = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updated.ticketsCount).to.equal(1);
  }).timeout(60000);
});
