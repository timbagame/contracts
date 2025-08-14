import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig, calculateWinnerIndex, getWinnerFromPlayers } from "./test-helpers";

// Verifies fee withdrawal transfers accumulated fees to oracle operator

describe("Withdraw Fee", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should withdraw accumulated fees to oracle operator", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    const ticketAmount = new anchor.BN(1_500_000);

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: ticketAmount,
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gameAccountBefore = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccountBefore.ticketsCount,
      gameData.secretKey,
      Number(gameAccountBefore.lastSlot)
    );
    const winnerPlayer = getWinnerFromPlayers([creator, player1], winnerIndex);

    await testUtils.game.completeGame(
      gameData,
      winnerPlayer.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const gameTokenAccount = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
    const accumulatedFee = new anchor.BN(gameTokenAccount.feeAmount);
    expect(accumulatedFee.gt(new anchor.BN(0))).to.be.true;

    // Operator balance before
    const operatorAta = await anchor.utils.token.associatedAddress({ owner: oracle.operator, mint: mint.mint });
    const operatorPre = await env.provider.connection.getTokenAccountBalance(operatorAta).catch(() => ({ value: { amount: "0" } }));

    await env.program.methods
      .withdrawTokenFee()
      .accounts({
        oracleOperator: oracle.operator,
        tokenMint: mint.mint,
      })
      .signers([oracle.operatorKeypair])
      .rpc();

    const gameTokenAfter = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
    expect(new anchor.BN(gameTokenAfter.feeAmount).isZero()).to.be.true;

    const operatorPost = await env.provider.connection.getTokenAccountBalance(operatorAta);
    const delta = new anchor.BN(operatorPost.value.amount).sub(new anchor.BN(operatorPre.value.amount));
    expect(delta.eq(accumulatedFee)).to.be.true;
  });
});
