import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Verifies dynamic bloom filter sizing per maxTickets

describe("Bloom Sizing", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  async function initGameWithMax(maxTickets: number) {
    const { mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const creator = players[0];

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(maxTickets),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    return { gameAccount };
  }

  it("sizes bloom proportionally to maxTickets (small)", async () => {
    const max = 2;
    const { gameAccount } = await initGameWithMax(max);
    // Rust consts: BLOOM_BITS_PER_ENTRY = 10, BLOOM_K = 7
    const BITS_PER_ENTRY = 10;
    const expectedMBits = BITS_PER_ENTRY * max;
    const expectedWords = Math.max(1, Math.ceil(expectedMBits / 64));

    expect(Number(gameAccount.bloomMBits)).to.equal(expectedMBits);
    expect(gameAccount.participantsFilter.length).to.equal(expectedWords);
    expect(Number(gameAccount.bloomK)).to.equal(7);
  });

  it("sizes bloom proportionally to maxTickets (medium)", async () => {
    const max = 100;
    const { gameAccount } = await initGameWithMax(max);
    const BITS_PER_ENTRY = 10;
    const expectedMBits = BITS_PER_ENTRY * max;
    const expectedWords = Math.max(1, Math.ceil(expectedMBits / 64));

    expect(Number(gameAccount.bloomMBits)).to.equal(expectedMBits);
    expect(gameAccount.participantsFilter.length).to.equal(expectedWords);
    expect(Number(gameAccount.bloomK)).to.equal(7);
  });

  it("sizes bloom proportionally to maxTickets (1k)", async () => {
    const max = 1000;
    const { gameAccount } = await initGameWithMax(max);
    const BITS_PER_ENTRY = 10;
    const expectedMBits = BITS_PER_ENTRY * max;
    const expectedWords = Math.max(1, Math.ceil(expectedMBits / 64));

    expect(Number(gameAccount.bloomMBits)).to.equal(expectedMBits);
    expect(gameAccount.participantsFilter.length).to.equal(expectedWords);
    expect(Number(gameAccount.bloomK)).to.equal(7);
  }).timeout(60000);
});

