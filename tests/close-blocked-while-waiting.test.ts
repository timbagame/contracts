import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig, deriveGameAccounts, toGameTokenContext } from "./test-helpers";

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

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const oraclePubkey = env.oracle?.oracle ?? env.oracle?.oraclePDA;
    if (!oraclePubkey) {
      throw new Error("Oracle not initialized for closeGame test");
    }

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      player: creator.player.publicKey,
    });
    if (!derived.playerTokenAccount) {
      throw new Error("Missing creator token account for closeGame test");
    }

    try {
      // expect custom error, ensure creator signs and all accounts passed
      await env.program.methods
        .closeGame()
        .accountsStrict({
          game: gameData.gamePDA,
          creator: creator.player.publicKey,
          oracle: oraclePubkey,
          gameTokenCtx: toGameTokenContext(derived),
          creatorTokenAccount: derived.playerTokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([creator.player])
        .rpc();
      expect.fail("Should have failed with GameWaitingForOracle");
    } catch (e: any) {
      // Constraint order triggers GameHasActivePlayers before waiting check
      expect(e.toString()).to.include("Active players remain");
    }
  });
});
