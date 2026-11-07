import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mutants-comment-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A fake gh: logs each call without its body, keeps the last body, and lists comment 7 as ours
// when OLD=1.
const gh = join(dir, "gh");
writeFileSync(
  gh,
  [
    "#!/usr/bin/env bash",
    'all="$*"',
    'echo "${all%% -f *}" >> "$LOG"',
    '[[ $all == *" -f body="* ]] && echo "${all#* -f body=}" > "$LOG.body"',
    "[[ $* == *--paginate* && $OLD == 1 ]] && echo 7",
    "exit 0",
  ].join("\n"),
);
chmodSync(gh, 0o755);

let body = "";

/** One language's results: what lived and the tally. `undefined` is a directory with no results. */
type Language = { lived: string; tally: string } | undefined;

function comment(languages: Language[], old: boolean, fork = false): string[] {
  const root = mkdtempSync(join(dir, "results-"));
  const log = join(root, "log");
  writeFileSync(log, "");
  const results = languages.map((language, index) => {
    const results = join(root, `language-${index}`);
    mkdirSync(results);
    if (language) {
      writeFileSync(join(results, "lived.txt"), language.lived);
      writeFileSync(join(results, "tally.txt"), language.tally);
    }
    return results;
  });
  const run = spawnSync("bash", [join(import.meta.dir, "./mutants-comment.sh"), ...results], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      LOG: log,
      OLD: old ? "1" : "0",
      FORK: String(fork),
      GITHUB_REPOSITORY: "o/r",
      PR: "5",
      RUN: "https://run",
    },
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  body = existsSync(`${log}.body`) ? readFileSync(`${log}.body`, "utf8") : "";
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

const ts = { lived: "scripts/a.ts:3  survived: X\n", tally: "1 of 2\n" };
const rust = {
  lived: "solana/programs/timba/src/state.rs:9  missed: replace f with 0\n",
  tally: "4 of 5\n",
};

describe("mutants comment", () => {
  const list = "api --paginate repos/o/r/issues/5/comments --jq";
  test("what lived is posted once, then edited in place", () => {
    const first = comment([ts], false);
    expect(first[0]).toStartWith(list);
    expect(first.slice(1)).toEqual(["api repos/o/r/issues/5/comments"]);
    expect(body).toStartWith("<!-- mutants -->\n**Mutation testing:** 1 of 2 changes caught");
    expect(body).toContain("\nscripts/a.ts:3  survived: X\n");
    expect(body).toContain("[Full report](https://run)");
    expect(comment([ts], true).slice(1)).toEqual(["api -X PATCH repos/o/r/issues/comments/7"]);
  });

  test("every language's results go in the same comment", () => {
    comment([ts, rust], false);
    expect(body).toContain("**Mutation testing:** 5 of 7 changes caught");
    expect(body).toContain(
      "\nscripts/a.ts:3  survived: X\nsolana/programs/timba/src/state.rs:9  missed: replace f with 0\n",
    );
  });

  test("a language with no results counts as nothing to mutate", () => {
    comment([undefined, rust], false);
    expect(body).toContain("**Mutation testing:** 4 of 5 changes caught");
    expect(body).not.toContain("scripts/a.ts");
    comment([undefined], true);
    expect(body).toBe("");
  });

  test("the comment goes once every change is caught", () => {
    const caught = { lived: "", tally: "2 of 2\n" };
    expect(comment([caught, caught], true).slice(1)).toEqual([
      "api -X DELETE repos/o/r/issues/comments/7",
    ]);
    expect(comment([caught], false).slice(1)).toEqual([]);
    expect(comment([undefined], true).slice(1)).toEqual([
      "api -X DELETE repos/o/r/issues/comments/7",
    ]);
  });

  test("a fork's run only summarizes", () => {
    expect(comment([ts], false, true)).toEqual([]);
  });

  test("it needs a directory", () => {
    const run = spawnSync("bash", [join(import.meta.dir, "./mutants-comment.sh")], {
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage:");
  });
});

test("long comments fit GitHub and keep whole rows and balanced fences", () => {
  comment(
    [{ lived: 'scripts/f.ts:12:3  survived: Literal → "á"\n'.repeat(3000), tally: "1 of 3001\n" }],
    false,
  );
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(60000);
  expect(body).toContain("Report trimmed. [Full report artifact](https://run#artifacts)");
  expect(body.match(/^```/gm)?.length).toBe(2);
  expect(body).not.toContain("�");
});
