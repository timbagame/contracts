import { describe, it, before } from "mocha";
import { expect } from "chai";
import fc from "fast-check";
import { calculateWinnerIndex } from "./test-helpers";

describe("Winner Index Property Tests", () => {
  before(() => {
    fc.configureGlobal({ seed: 20250101, numRuns: 200 });
  });

  it("always produces a valid winner index within ticket bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 32, maxLength: 32 }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (
          ticketsCount: number,
          secretKey: number[],
          slot: number
        ) => {
          const winnerIndex = calculateWinnerIndex(ticketsCount, secretKey, slot);
          expect(winnerIndex).to.be.at.least(0);
          expect(winnerIndex).to.be.below(ticketsCount);
        }
      ),
      { seed: 20250101 }
    );
  });

  it("is deterministic for identical inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 32, maxLength: 32 }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (
          ticketsCount: number,
          secretKey: number[],
          slot: number
        ) => {
          const first = calculateWinnerIndex(ticketsCount, secretKey, slot);
          const second = calculateWinnerIndex(ticketsCount, [...secretKey], slot);
          expect(first).to.equal(second);
        }
      ),
      { seed: 606060 }
    );
  });

  it("samples every possible winner slot under uniform randomness", () => {
    const ticketsCount = 8;
    const seen = new Set<number>();

    const sampleSecrets = fc.sample(
      fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 32, maxLength: 32 }),
      { seed: 424242, numRuns: 512 }
    );

    sampleSecrets.forEach((secret: number[], idx: number) => {
      const slot = idx * 17;
      const winnerIndex = calculateWinnerIndex(ticketsCount, secret, slot);
      seen.add(winnerIndex);
    });

    for (let i = 0; i < ticketsCount; i += 1) {
      expect(seen.has(i), `expected to see winner index ${i}`).to.be.true;
    }
  });
});
