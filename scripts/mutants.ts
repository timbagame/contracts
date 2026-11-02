/**
 * Mutation testing: a tool changes source lines a little, one change at a time, and runs the
 * tests that reach each change. A change no test notices is a missing test.
 *
 *   bun run scripts/mutants.ts ts diff origin/main     # TypeScript: Stryker, the lines this branch changed
 *   bun run scripts/mutants.ts sol part 3 64           # Solidity: vertigo-rs, the 4th of 64 equal parts
 *   bun run scripts/mutants.ts ts diff HEAD^1 --out build/mutants
 *
 * Solana's Rust is mutated by scripts/mutants-rust.sh. This picks the lines for the other two
 * languages: the TypeScript scripts in scripts/ (what the coverage tests in scripts/*.test.ts
 * reach) and the Solidity contract and its scripts, the sources the EVM coverage gate counts.
 * vertigo-rs only takes whole files, so scripts/mutants-sol/run.py keeps the changes on the
 * chosen lines. Lists what lived by file and line; --out also writes it to lived.txt and the
 * tally ("3 of 10") to tally.txt there. Exits 0 once it got to its tally, whatever lived; only
 * a broken run fails. Stryker's full report is in reports/mutation/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REPORT = join(ROOT, "reports/mutation/mutation.json");

export type Language = "ts" | "sol";

/** A line range of one file, as Stryker's `--mutate` takes it: "scripts/a.ts:3-9". */
export interface Range {
  file: string;
  from: number;
  to: number;
}

/** Whether `file` is source `language` mutates. */
export function inScope(file: string, language: Language): boolean {
  if (language === "ts") {
    return (
      /^scripts\/[^/]+\.ts$/.test(file) &&
      !file.endsWith(".test.ts") &&
      !file.startsWith("scripts/mutants")
    );
  }
  return /^evm\/(src|script)\/.+\.sol$/.test(file);
}

/** The order parts are cut in: the contract before its scripts, otherwise by path. */
export function compareFiles(a: string, b: string): number {
  const rank = (file: string) => (file.startsWith("evm/src/") ? 0 : 1);
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** The ranges of lines a unified diff with no context (`-U0`) adds or changes. */
export function changedRanges(diff: string): Range[] {
  const ranges: Range[] = [];
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      file = path === "/dev/null" ? undefined : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const from = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) ranges.push({ file, from, to: from + count - 1 });
    }
  }
  return ranges;
}

/** Every line of every file, in order, cut into `n` parts as equal as whole lines allow; the `k`th, 0-based, as ranges. */
export function partRanges(
  files: { file: string; lines: number }[],
  k: number,
  n: number,
): Range[] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k >= n) {
    throw new Error(`part ${k} isn't one of 0 to ${n - 1}`);
  }
  const total = files.reduce((sum, { lines }) => sum + lines, 0);
  const start = Math.floor((total * k) / n);
  const end = Math.floor((total * (k + 1)) / n);
  const ranges: Range[] = [];
  let offset = 0;
  for (const { file, lines } of files) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + lines);
    if (from < to) ranges.push({ file, from: from - offset + 1, to: to - offset });
    offset += lines;
  }
  return ranges;
}

interface Mutant {
  status: string;
  mutatorName: string;
  replacement?: string | undefined;
  location: { start: { line: number } };
}

/** What no test caught, "scripts/a.ts:12  survived: EqualityOperator", by file and line, and how many mutants there were. */
export function lived(report: { files: Record<string, { mutants: Mutant[] }> }): {
  rows: string[];
  total: number;
} {
  const left: [string, number, string][] = [];
  let total = 0;
  for (const [path, { mutants }] of Object.entries(report.files)) {
    const file = path.startsWith("/") ? relative(ROOT, path) : path;
    for (const mutant of mutants) {
      if (mutant.status === "CompileError" || mutant.status === "Ignored") continue;
      total++;
      if (["Survived", "NoCoverage", "Timeout"].includes(mutant.status)) {
        const status = mutant.status === "NoCoverage" ? "no coverage" : mutant.status.toLowerCase();
        const line = mutant.location.start.line;
        const change =
          mutant.replacement === undefined ? "" : ` → ${JSON.stringify(mutant.replacement)}`;
        left.push([file, line, `${file}:${line}  ${status}: ${mutant.mutatorName}${change}`]);
      }
    }
  }
  left.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  return { rows: left.map(([, , row]) => row), total };
}

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function sourceFiles(language: Language): { file: string; lines: number }[] {
  return git("ls-files", "-z")
    .split("\0")
    .filter((file) => file && inScope(file, language))
    .sort(compareFiles)
    .map((file) => ({
      file,
      lines: readFileSync(join(ROOT, file), "utf8").split("\n").length,
    }));
}

function writeResults(out: string, rows: string[], tally: string): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "lived.txt"), rows.map((row) => `${row}\n`).join(""));
  writeFileSync(join(out, "tally.txt"), `${tally}\n`);
}

/** Stryker on the ranges; 0 once its report is in. */
function mutateTypeScript(ranges: Range[], out: string | undefined): number {
  rmSync(REPORT, { force: true });
  const mutate = ranges.map(({ file, from, to }) => `${file}:${from}-${to}`).join(",");
  const run = spawnSync("bun", ["x", "stryker", "run", "--mutate", mutate], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (run.status !== 0 || !existsSync(REPORT)) {
    console.error(`Stryker stopped (exit ${run.status ?? run.signal}) before its report.`);
    return 1;
  }
  const { rows, total } = lived(JSON.parse(readFileSync(REPORT, "utf8")));
  rows.forEach((row) => console.log(row));
  const tally = `${total - rows.length} of ${total}`;
  console.log(`${tally} changes caught by a test.`);
  if (out) writeResults(out, rows, tally);
  return 0;
}

/** vertigo-rs on the ranges, through scripts/mutants-sol/run.py, which writes the results; 0 once it got to its tally. */
function mutateSolidity(ranges: Range[], out: string): number {
  const python = process.env["MUTANTS_PYTHON"] ?? "python3";
  const run = spawnSync(
    python,
    [
      join(ROOT, "scripts/mutants-sol/run.py"),
      "--ranges",
      ranges.map(({ file, from, to }) => `${file}:${from}-${to}`).join(","),
      "--out",
      out,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (run.status !== 0) {
    console.error(`vertigo-rs stopped (exit ${run.status ?? run.signal}) before its tally.`);
    return 1;
  }
  return 0;
}

function main(argv: string[]): number {
  const usage = "Usage: bun run scripts/mutants.ts ts|sol diff BASE | part K N [--out DIR]";
  const language = argv[0] === "ts" || argv[0] === "sol" ? argv[0] : undefined;
  const outFlag = argv.indexOf("--out");
  const out = outFlag >= 0 ? argv[outFlag + 1] : undefined;
  let ranges: Range[];
  if (language && argv[1] === "diff" && argv[2]) {
    const since = git("merge-base", argv[2], "HEAD").trim();
    ranges = changedRanges(git("diff", "-U0", "--no-color", since, "HEAD")).filter((range) =>
      inScope(range.file, language),
    );
  } else if (language && argv[1] === "part" && argv[2] && argv[3]) {
    ranges = partRanges(sourceFiles(language), Number(argv[2]), Number(argv[3]));
  } else {
    console.error(usage);
    return 2;
  }
  if (ranges.length === 0) {
    console.log("No source lines to mutate.");
    console.log("0 of 0 changes caught by a test.");
    if (out) writeResults(out, [], "0 of 0");
    return 0;
  }
  console.log(
    `${ranges.length} ranges in ${new Set(ranges.map((range) => range.file)).size} files.`,
  );
  return language === "ts"
    ? mutateTypeScript(ranges, out)
    : mutateSolidity(ranges, out ?? "build/mutants");
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
