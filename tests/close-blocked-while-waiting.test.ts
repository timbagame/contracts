import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Ensures close_game blocked while waiting_for_oracle (game either not expired or ready path)

describe("Close Blocked While Waiting", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject closing a game still waiting for oracle", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    try { // expect custom error, ensure creator signs and all accounts passed
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
      expect.fail("Should have failed with GameWaitingForOracle");
    } catch (e: any) {
      expect(e.toString()).to.include("Game waiting for oracle");
    }
  });
});
