import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  GameConfig,
  TestEnvironment,
  TestUtils,
  calculateWinnerIndex,
  getWinnerFromPlayers,
} from "./test-helpers";

// Ensures both legacy SPL Token and token-2022 mints exercise full game flows
// without triggering token-program specific regressions.
describe("Token program compatibility", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    testUtils = env.testUtils ?? new TestUtils();
  });

  async function runCoinflipFlow(tokenProgram: anchor.web3.PublicKey) {
    const mint = await testUtils.mint.createMint({ tokenProgram });
    const creator = await testUtils.player.createPlayer(mint.mint);
    const challenger = await testUtils.player.createPlayer(mint.mint);

    const startingBalance = new anchor.BN(5_000_000);
    await testUtils.mint.mintTokensToAccount(
      mint,
      creator.playerTokenAccount.address,
      startingBalance
    );
    await testUtils.mint.mintTokensToAccount(
      mint,
      challenger.playerTokenAccount.address,
      startingBalance
    );

    const ticketAmount = new anchor.BN(1_000_000);
    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: ticketAmount,
      maxTickets: 2,
      minTickets: 2,
      timeout: new anchor.BN(600),
      isPrivate: false,
    };

    const gameData = testUtils.game.generateGamePDA();
    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, challenger.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      gameAccount.lastSlot.toNumber()
    );
    const players = [creator, challenger];
    const winner = getWinnerFromPlayers(players, winnerIndex);

    const winnerPre = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );

    const totalPot = ticketAmount.mul(new anchor.BN(players.length));
    const feePct = new anchor.BN(env.oracle!.config.feePercentage);
    const expectedFee = totalPot.mul(feePct).div(new anchor.BN(100));
    const expectedWinnerDelta = totalPot.sub(expectedFee);

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      env.oracle!.operator,
      winnerIndex,
      env.oracle!.operatorKeypair
    );

    const winnerPost = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );

    const delta = new anchor.BN(winnerPost.value.amount).sub(
      new anchor.BN(winnerPre.value.amount)
    );
    expect(delta.eq(expectedWinnerDelta)).to.be.true;

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    expect(new anchor.BN(gameTokenAccount.feeAmount).eq(expectedFee)).to.be
      .true;
  }

  it("supports legacy spl-token mint flows", async () => {
    await runCoinflipFlow(TOKEN_PROGRAM_ID);
  });

  it("supports token-2022 mint flows", async () => {
    await runCoinflipFlow(TOKEN_2022_PROGRAM_ID);
  });
});
