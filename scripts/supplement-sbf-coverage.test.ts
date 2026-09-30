import { expect, test } from "bun:test";
import { supplementSourceHits } from "./supplement-sbf-coverage";

test("supplements matching deployed source lines without dropping misses or changing inventory", () => {
  const sbf = "SF:programs/timba/src/state.rs\nDA:10,0\nDA:20,0\nDA:30,2\nend_of_record\n";
  const host =
    "SF:/repo/solana/test-harness/../programs/timba/src/state.rs\nDA:10,1\nDA:30,3\nDA:99,4\nend_of_record\nSF:/repo/solana/other.rs\nDA:20,5\nend_of_record\n";
  expect(supplementSourceHits(sbf, host, "/repo/solana")).toBe(
    sbf.replace("DA:10,0", "DA:10,1").replace("DA:30,2", "DA:30,5"),
  );
});

test("recomputes per-record LCOV summaries while preserving checksums", () => {
  const sbf =
    "SF:one.rs\nDA:1,0,abc\nDA:2,1\nLF:2\nLH:1\nend_of_record\nSF:two.rs\nDA:1,0\nLF:1\nLH:0\nend_of_record\n";
  const host = "SF:one.rs\nDA:1,2\nend_of_record\n";
  expect(supplementSourceHits(sbf, host, "/repo")).toBe(
    sbf.replace("DA:1,0,abc", "DA:1,2,abc").replace("LH:1", "LH:2"),
  );
});
