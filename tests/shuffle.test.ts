import { expect } from "chai";
import { TestEnvironment } from "./test-helpers";

describe("TestEnvironment.shuffle", () => {
  it("returns new array with same elements", () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = TestEnvironment.shuffle(original);

    // ensure it doesn't mutate the original array
    expect(original).to.deep.equal([1, 2, 3, 4, 5]);

    // check that all elements are present
    expect(shuffled).to.have.members(original);

    // ensure a new array is returned
    expect(shuffled).to.not.equal(original);
  });
});
