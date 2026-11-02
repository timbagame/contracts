import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mutants-rust-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const script = join(import.meta.dir, "./mutants-rust.sh");

/** Runs `summarize` on a fake cargo-mutants output with these files; returns what it wrote. */
function summarize(files: Record<string, string>) {
  const root = mkdtempSync(join(dir, "case-"));
  const from = join(root, "mutants.out");
  mkdirSync(from);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(from, name), text);
  const out = join(root, "out");
  const run = spawnSync("bash", [script, "summarize", from, out], {
    encoding: "utf8",
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  return {
    lived: readFileSync(join(out, "lived.txt"), "utf8"),
    tally: readFileSync(join(out, "tally.txt"), "utf8"),
    stdout: run.stdout,
  };
}

describe("mutants-rust summarize", () => {
  test("what cargo-mutants missed is listed by file and line", () => {
    const { lived, tally, stdout } = summarize({
      "caught.txt":
        "programs/timba/src/a.rs:1:1: replace x with 1\nprograms/timba/src/a.rs:2:1: replace y with 2\n",
      "missed.txt":
        "programs/timba/src/b.rs:12:5: replace f -> bool with true\nprograms/timba/src/a.rs:30:9: replace == with != in g\n",
      "timeout.txt": "programs/timba/src/a.rs:4:2: replace h with ()\n",
      "unviable.txt": "programs/timba/src/a.rs:9:9: replace k -> String with String::new()\n",
    });
    expect(lived).toBe(
      [
        "solana/programs/timba/src/a.rs:4  timeout: replace h with ()",
        "solana/programs/timba/src/a.rs:30  missed: replace == with != in g",
        "solana/programs/timba/src/b.rs:12  missed: replace f -> bool with true",
        "",
      ].join("\n"),
    );
    expect(tally).toBe("2 of 5\n");
    expect(stdout).toBe(`${lived}2 of 5 changes caught by a test.\n`);
  });

  test("every mutant caught leaves nothing lived", () => {
    const { lived, tally } = summarize({
      "caught.txt": "programs/timba/src/a.rs:1:1: replace x with 1\n",
      "missed.txt": "",
      "timeout.txt": "",
    });
    expect(lived).toBe("");
    expect(tally).toBe("1 of 1\n");
  });

  test("no results counts as nothing to mutate", () => {
    const { lived, tally } = summarize({});
    expect(lived).toBe("");
    expect(tally).toBe("0 of 0\n");
  });

  test("it needs a mode", () => {
    const run = spawnSync("bash", [script], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage:");
  });
});

describe("mutants-rust found", () => {
  function found(list: string | null) {
    const root = mkdtempSync(join(dir, "found-"));
    if (list !== null) writeFileSync(join(root, "mutants.json"), list);
    return spawnSync("bash", [script, "found", root], { encoding: "utf8" });
  }

  test("a list with mutants passes", () => {
    expect(found('[{"name":"replace f with ()"}]').status).toBe(0);
  });

  test("an empty or missing list is a broken setup", () => {
    for (const list of ["[]", "[\n]\n", "", null]) {
      const run = found(list);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("examine_globs");
    }
  });
});
