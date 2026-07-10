import { expect } from "chai";
import { getWinnerFromPlayers } from "./test-helpers";

describe("Unit Utils", () => {
  it("getWinnerFromPlayers bounds check", () => {
    const fakePlayers = [{}, {}, {}] as any;
    expect(() => getWinnerFromPlayers(fakePlayers, 3)).to.throw(
      /out of bounds/
    );
    expect(getWinnerFromPlayers(fakePlayers, 2)).to.equal(fakePlayers[2]);
  });
});
