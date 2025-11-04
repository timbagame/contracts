import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";
import { TestUtils, TestEnvironment, coinflipGameConfig } from "./test-helpers";

function participantHash(game: anchor.web3.PublicKey, player: anchor.web3.PublicKey): bigint {
  const domain = Buffer.from("timba:part:v1");
  const digest = createHash("sha256")
    .update(domain)
    .update(game.toBuffer())
    .update(player.toBuffer())
    .digest();
  return digest.subarray(0, 8).readBigUInt64LE(0);
}

describe("Participant Hash Collision Stress", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("tracks unique participant hashes across large player pool", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const joinCount = 64;
    const ticketAmount = new anchor.BN(750_000);

    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
      maxTickets: joinCount + 1,
      minTickets: 2,
      timeout: 180,
    });

    const freshPlayers = await testUtils.player.createPlayerPool(
      joinCount,
      mint.mint
    );

    for (const newcomer of freshPlayers) {
      await testUtils.player.fundPlayer(newcomer, mint, ticketAmount);
    }

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    for (const newcomer of freshPlayers) {
      await testUtils.game.joinGame(gameData.gamePDA, newcomer.player);
    }

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(joinCount + 1);
    expect(gameAccount.participantHashes.length).to.equal(joinCount + 1);

    const seen = new Set<string>();
    for (const hash of gameAccount.participantHashes) {
      const key = hash.toString();
      expect(seen.has(key)).to.be.false;
      seen.add(key);
    }
    expect(seen.size).to.equal(joinCount + 1);

    const orderedParticipants = [creator, ...freshPlayers];
    orderedParticipants.forEach((participant, index) => {
      const expectedHash = participantHash(
        gameData.gamePDA,
        participant.player.publicKey
      );
      const onChain = BigInt(gameAccount.participantHashes[index].toString());
      expect(onChain).to.equal(expectedHash);
    });

    // Sanity: ensure vault still tracks aggregate pot correctly after mass joins.
    const expectedPot = ticketAmount.mul(new anchor.BN(joinCount + 1));
    expect(gameAccount.totalAmount.toString()).to.equal(
      expectedPot.toString()
    );
  }).timeout(180_000);
});
