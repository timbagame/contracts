import { expect } from "chai";
import { calculateWinnerIndex, getWinnerFromPlayers } from "./test-helpers";

describe("Unit Utils", () => {
  it("calculateWinnerIndex returns 0 for single entry", () => {
    const idx = calculateWinnerIndex(1, new Array(32).fill(1), 12345);
    expect(idx).to.equal(0);
  });

  it("getWinnerFromPlayers bounds check", () => {
    const fakePlayers = [{}, {}, {}] as any;
    expect(() => getWinnerFromPlayers(fakePlayers, 3)).to.throw(/out of bounds/);
    expect(getWinnerFromPlayers(fakePlayers, 2)).to.equal(fakePlayers[2]);
  });
});

