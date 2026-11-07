import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCoverage, main } from "./check-coverage";

// The gate CI runs as `bun run scripts/check-coverage.ts <config> <lcov>...`. Each case runs twice:
// as a real subprocess, which is what CI does and the only way to reach the `import.meta.main`
// block, and in process, because a mutation tool only credits a test for code it ran itself.

const script = join(import.meta.dir, "check-coverage.ts");
const scratch = mkdtempSync(join(tmpdir(), "timba-coverage-cli-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Outcome = { code: number; stdout: string; stderr: string };
type Run = (root: string, ...args: string[]) => Promise<Outcome>;

const runSubprocess: Run = async (root, ...args) => {
  const run = Bun.spawnSync(["bun", "run", script, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: run.exitCode ?? -1,
    stdout: new TextDecoder().decode(run.stdout),
    stderr: new TextDecoder().decode(run.stderr),
  };
};

const runInProcess: Run = async (root, ...args) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = spyOn(console, "log").mockImplementation(
    (...parts) => void stdout.push(parts.join(" ")),
  );
  const error = spyOn(console, "error").mockImplementation(
    (...parts) => void stderr.push(parts.join(" ")),
  );
  try {
    const code = await main(args, root);
    return {
      code,
      stdout: stdout.map((line) => `${line}\n`).join(""),
      stderr: stderr.map((line) => `${line}\n`).join(""),
    };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
};

/** A fake repository: tracked files, a config for them and the LCOV reports to check. */
function repository(files: string[], reports: Record<string, string>, config?: object): string {
  const root = mkdtempSync(join(scratch, "repo-"));
  for (const file of files) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), "synthetic\n");
  }
  writeFileSync(
    join(root, "coverage.json"),
    JSON.stringify(config ?? { roots: ["src"], extensions: [".ts"] }),
  );
  for (const [name, content] of Object.entries(reports)) writeFileSync(join(root, name), content);
  const git = Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  expect(git.exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "add", "."], { cwd: root }).exitCode).toBe(0);
  return root;
}

/** One source file's LCOV record: a hit count per line, in order from line 1. */
function record(file: string, ...hits: number[]): string {
  return `SF:${file}\n${hits.map((count, index) => `DA:${index + 1},${count}`).join("\n")}\nend_of_record\n`;
}

const usage = "Usage: bun run scripts/check-coverage.ts <config> <lcov-report> [...]\n";
const incomplete = "Coverage is incomplete: scoped source files are absent from LCOV.\n";

for (const [name, run] of [
  ["subprocess", runSubprocess],
  ["in process", runInProcess],
] as [string, Run][]) {
  describe(`coverage gate command line (${name})`, () => {
    beforeEach(() => {
      // A leftover exit code from a mutated run must not leak into bun's own.
      process.exitCode = 0;
    });

    test("full coverage exits 0 and reports it", async () => {
      const root = repository(["src/a.ts"], { "full.info": record("src/a.ts", 1, 5, 1) });
      const outcome = await run(root, "coverage.json", "full.info");
      expect(outcome.code).toBe(0);
      expect(JSON.parse(outcome.stdout)).toEqual({
        threshold: 100,
        covered: 3,
        total: 3,
        percent: 100,
        missing: [],
        passed: true,
      });
      expect(outcome.stderr).toBe("");
    });

    test("one uncovered line exits 1 and reports the shortfall", async () => {
      const hits = Array.from({ length: 100 }, (_, index) => (index === 0 ? 0 : 1));
      const root = repository(["src/a.ts"], { "low.info": record("src/a.ts", ...hits) });
      const outcome = await run(root, "coverage.json", "low.info");
      expect(outcome.code).toBe(1);
      expect(JSON.parse(outcome.stdout)).toEqual({
        threshold: 100,
        covered: 99,
        total: 100,
        percent: 99,
        missing: [],
        passed: false,
      });
      expect(outcome.stderr).toBe("");
    });

    test("the percentage is rounded to two decimals", async () => {
      const root = repository(["src/a.ts"], { "third.info": record("src/a.ts", 1, 1, 0) });
      const outcome = await run(root, "coverage.json", "third.info");
      expect(outcome.code).toBe(1);
      expect(JSON.parse(outcome.stdout)).toMatchObject({ covered: 2, total: 3, percent: 66.67 });
    });

    test("every report on the command line is merged", async () => {
      const root = repository(["src/a.ts"], {
        "first.info": record("src/a.ts", 1, 0),
        "second.info": record("src/a.ts", 0, 1),
      });
      const merged = await run(root, "coverage.json", "first.info", "second.info");
      expect(merged.code).toBe(0);
      expect(JSON.parse(merged.stdout)).toMatchObject({ covered: 2, total: 2, passed: true });
      expect((await run(root, "coverage.json", "first.info")).code).toBe(1);
    });

    test("a scoped file absent from every report fails and is named", async () => {
      const root = repository(["src/a.ts", "src/b.ts"], { "a.info": record("src/a.ts", 1, 1) });
      const outcome = await run(root, "coverage.json", "a.info");
      expect(outcome.code).toBe(1);
      expect(JSON.parse(outcome.stdout)).toMatchObject({
        covered: 2,
        total: 2,
        percent: 100,
        missing: ["src/b.ts"],
        passed: false,
      });
      expect(outcome.stderr).toBe(incomplete);
    });

    test("an absolute config path works", async () => {
      const root = repository(["src/a.ts"], { "full.info": record("src/a.ts", 1) });
      const outcome = await run(root, join(root, "coverage.json"), "full.info");
      expect(outcome.code).toBe(0);
      expect(JSON.parse(outcome.stdout)).toMatchObject({ passed: true });
    });

    test("no arguments, or a config with no report, is a usage error", async () => {
      const root = repository(["src/a.ts"], { "full.info": record("src/a.ts", 1) });
      for (const args of [[], ["coverage.json"]]) {
        const outcome = await run(root, ...args);
        expect(outcome).toEqual({ code: 2, stdout: "", stderr: usage });
      }
    });

    test("a malformed report exits 1 with the reason", async () => {
      const root = repository(["src/a.ts"], {
        "bad.info": "SF:src/a.ts\nDA:1,-1\nend_of_record\n",
        "empty.info": "",
      });
      expect(await run(root, "coverage.json", "bad.info")).toEqual({
        code: 1,
        stdout: "",
        stderr: "Coverage gate failed: Invalid LCOV line data\n",
      });
      expect(await run(root, "coverage.json", "empty.info")).toEqual({
        code: 1,
        stdout: "",
        stderr: "Coverage gate failed: No scoped line data in empty.info\n",
      });
    });

    test("an unreadable report or config exits 1 with the reason", async () => {
      const root = repository(["src/a.ts"], { "full.info": record("src/a.ts", 1) });
      const report = await run(root, "coverage.json", "absent.info");
      expect(report.code).toBe(1);
      expect(report.stdout).toBe("");
      expect(report.stderr).toStartWith("Coverage gate failed: ");
      expect(report.stderr).toContain("absent.info");
      const config = await run(root, "absent.json", "full.info");
      expect(config.code).toBe(1);
      expect(config.stdout).toBe("");
      expect(config.stderr).toStartWith("Coverage gate failed: ");
      expect(config.stderr).toContain("absent.json");
    });
  });
}

test("importing the module runs nothing: only the command line runs the gate", () => {
  const run = Bun.spawnSync(
    ["bun", "-e", `await import(${JSON.stringify(script)}); console.log(String(process.exitCode))`],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(new TextDecoder().decode(run.stderr)).toBe("");
  expect(new TextDecoder().decode(run.stdout)).toBe("undefined\n");
  expect(run.exitCode).toBe(0);
});

test("a gate given no reports at all refuses to pass", async () => {
  // The command line never gets here (it needs a report), so this is the only guard for a caller
  // that passes none.
  const root = repository(["src/a.ts"], {});
  await expect(checkCoverage({ roots: ["src"], extensions: [".ts"] }, [], root)).rejects.toThrow(
    "No instrumented source lines in coverage reports",
  );
});
