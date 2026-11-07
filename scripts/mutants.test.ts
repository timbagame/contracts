import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  changedRanges,
  instrumentRanges,
  compareFiles,
  inScope,
  lived,
  partRanges,
} from "./mutants.js";

describe("mutants", () => {
  test("TypeScript mutates the scripts the coverage tests reach, not tests or the mutation setup", () => {
    for (const file of ["scripts/check-coverage.ts", "scripts/supplement-sbf-coverage.ts"]) {
      expect(inScope(file, "ts")).toBe(true);
    }
    for (const file of [
      "scripts/mutants.ts",
      "scripts/mutants-rust.sh",
      "scripts/check-coverage.test.ts",
      "scripts/mutants-sol/run.py",
      "scripts/nested/a.ts",
      "solana/scripts/generate-client.ts",
      "evm/src/Timba.sol",
      "scripts/readme.md",
    ]) {
      expect(inScope(file, "ts")).toBe(false);
    }
  });

  test("Solidity mutates the sources the EVM coverage gate counts, not tests or libraries", () => {
    for (const file of ["evm/src/Timba.sol", "evm/script/Deploy.s.sol"]) {
      expect(inScope(file, "sol")).toBe(true);
    }
    for (const file of [
      "evm/test/Timba.t.sol",
      "evm/lib/forge-std/src/Test.sol",
      "evm/script/local-smoke.sh",
      "solana/programs/timba/src/lib.rs",
      "scripts/check-coverage.ts",
    ]) {
      expect(inScope(file, "sol")).toBe(false);
    }
  });

  test("parts are cut through the contract first, then its scripts", () => {
    const files = ["evm/script/Deploy.s.sol", "evm/src/Timba.sol", "evm/script/A.s.sol"];
    expect(files.sort(compareFiles)).toEqual([
      "evm/src/Timba.sol",
      "evm/script/A.s.sol",
      "evm/script/Deploy.s.sol",
    ]);
    expect(["scripts/b.ts", "scripts/a.ts"].sort(compareFiles)).toEqual([
      "scripts/a.ts",
      "scripts/b.ts",
    ]);
  });

  test("a diff's added and changed lines become ranges, deletions none", () => {
    const diff = [
      "diff --git a/scripts/a.ts b/scripts/a.ts",
      "--- a/scripts/a.ts",
      "+++ b/scripts/a.ts",
      "@@ -3 +3 @@ x",
      "@@ -10,0 +11,4 @@ y",
      "@@ -20,2 +24,0 @@ z",
      "diff --git a/scripts/gone.ts b/scripts/gone.ts",
      "--- a/scripts/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "--- a/scripts/b.ts",
      "+++ b/scripts/b.ts",
      "@@ -1,2 +1,2 @@",
    ].join("\n");
    expect(changedRanges(diff)).toEqual([
      { file: "scripts/a.ts", from: 3, to: 3 },
      { file: "scripts/a.ts", from: 11, to: 14 },
      { file: "scripts/b.ts", from: 1, to: 2 },
    ]);
  });

  test("parts cover every line once, as equal as whole lines allow", () => {
    const files = [
      { file: "scripts/a.ts", lines: 5 },
      { file: "scripts/b.ts", lines: 1 },
      { file: "scripts/c.ts", lines: 4 },
    ];
    for (const n of [1, 3, 4, 10, 12]) {
      const lines = Array.from({ length: n }, (_, k) =>
        partRanges(files, k, n).flatMap(({ file, from, to }) =>
          Array.from({ length: to - from + 1 }, (_, i) => `${file}:${from + i}`),
        ),
      );
      expect(lines.flat()).toEqual([
        ...Array.from({ length: 5 }, (_, i) => `scripts/a.ts:${i + 1}`),
        "scripts/b.ts:1",
        ...Array.from({ length: 4 }, (_, i) => `scripts/c.ts:${i + 1}`),
      ]);
      const sizes = lines.map((part) => part.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
    expect(partRanges(files, 1, 3)).toEqual([
      { file: "scripts/a.ts", from: 4, to: 5 },
      { file: "scripts/b.ts", from: 1, to: 1 },
    ]);
    for (const k of [-1, 4, 1.5]) {
      expect(() => partRanges(files, k, 4)).toThrow();
    }
  });

  test("what no test caught is listed by file and line", () => {
    const mutant = (
      status: string,
      line: number,
      mutatorName = "EqualityOperator",
      replacement?: string,
    ) => ({
      status,
      mutatorName,
      replacement,
      location: { start: { line, column: 7 }, end: { line, column: 9 } },
    });
    const { rows, total } = lived({
      files: {
        "scripts/b.ts": {
          mutants: [mutant("Survived", 9, "BooleanLiteral", "false"), mutant("Killed", 1)],
        },
        "scripts/a.ts": {
          mutants: [
            mutant("NoCoverage", 12),
            mutant("Timeout", 2, "UpdateOperator"),
            mutant("CompileError", 3),
            mutant("Ignored", 4),
          ],
        },
      },
    });
    expect(total).toBe(4);
    expect(rows).toEqual([
      "scripts/a.ts:2:7-2:9  timeout: UpdateOperator",
      "scripts/a.ts:12:7-12:9  no coverage: EqualityOperator",
      'scripts/b.ts:9:7-9:9  survived: BooleanLiteral → "false"',
    ]);
  });

  test("the Solidity runner's own tests pass", () => {
    const run = spawnSync(
      process.env["MUTANTS_PYTHON"] ?? "python3",
      ["-B", "-m", "unittest", "discover", "-s", "scripts/mutants-sol", "-p", "test_*.py"],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8" },
    );
    expect(run.stderr).toContain("OK");
    expect(run.status).toBe(0);
  });
});

test("crossing nodes are instrumented whole and owned only by their start lines", () => {
  const content = "export function f() {\n  if (true) {\n    return 1;\n  }\n}\n";
  const ranges = [{ file: "src/a.ts", from: 2, to: 2 }];
  expect(instrumentRanges(ranges, () => content)).toEqual([{ file: "src/a.ts", from: 2, to: 4 }]);
  const make = (line: number, column: number, end = column + 1) => ({
    status: "Survived",
    mutatorName: "BooleanLiteral",
    replacement: "false",
    location: { start: { line, column }, end: { line, column: end } },
  });
  const report = {
    files: { "src/a.ts": { mutants: [make(2, 7, 14), make(2, 7, 21), make(3, 7)] } },
  };
  const { rows, total } = lived(report, ranges);
  expect(total).toBe(2);
  expect(new Set(rows).size).toBe(2);
  expect(lived(report, [{ file: "src/a.ts", from: 3, to: 4 }]).rows).toHaveLength(1);
});
