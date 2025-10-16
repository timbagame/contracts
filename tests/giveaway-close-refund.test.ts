import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Verifies that closing an unused giveaway refunds the prize to creator

describe("Giveaway Close Refund", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should refund full prize to creator when closing unused giveaway", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();

    const prizeAmount = new anchor.BN(5_000_000);

    const gameConfig: GameConfig = {
      gameType: { giveaway: {} },
      amount: prizeAmount, // total prize
      maxTickets: new anchor.BN(10),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(30), // short timeout
      isPrivate: false,
    };

    // Record creator balance before funding
    const beforeBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    // Balance decreased by prizeAmount (since total_amount funded at creation)
    const midBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );
    expect(
      new anchor.BN(beforeBal.value.amount)
        .sub(new anchor.BN(midBal.value.amount))
        .eq(prizeAmount)
    ).to.be.true;

    // Wait until timeout + small buffer so waiting_for_oracle becomes false
    await new Promise((r) => setTimeout(r, 4000));

    // Close game (no joins happened)
    await env.program.methods
      .closeGame()
      .accounts({
        creator: creator.player.publicKey,
        game: gameData.gamePDA,
        tokenMint: mint.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator.player])
      .rpc();

    // Creator should be refunded full prize
    const afterBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    expect(
      new anchor.BN(afterBal.value.amount).eq(
        new anchor.BN(beforeBal.value.amount)
      )
    ).to.be.true;
  }).timeout(45000);
});
