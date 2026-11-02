"""Mutation testing for the Solidity contract with vertigo-rs.

vertigo-rs changes the contract a little at a time (flips a comparison, drops a call)
and runs `forge test` for each change. A change no test notices is a missing test.

    python scripts/mutants-sol/run.py --ranges evm/src/Timba.sol:10-40,evm/src/Timba.sol:90-95 --out build/mutants

vertigo-rs can't pick lines, only files, so it mutates the files named in --ranges and
this keeps the changes that start on one of the lines. It writes what lived to
OUT/lived.txt ("evm/src/Timba.sol:57  lived: > -> >=") and the tally ("3 of 10") to
OUT/tally.txt, the same files scripts/mutants.ts writes. It exits 0 once it got to its
tally, whatever lived; only a broken run (the tests fail unmutated, forge or vertigo-rs
missing) fails.
"""

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAX_CHANGE = 70


def parse_ranges(text):
    """'a.sol:3-9,b.sol:1-1' -> {'a.sol': [(3, 9)], 'b.sol': [(1, 1)]}"""
    ranges = {}
    for item in filter(None, text.split(",")):
        match = re.fullmatch(r"(.+):(\d+)-(\d+)", item)
        if not match:
            raise ValueError(f"not a range like file:from-to: {item!r}")
        file, start, end = match.group(1), int(match.group(2)), int(match.group(3))
        ranges.setdefault(file, []).append((start, end))
    return ranges


def in_ranges(ranges, file, line):
    """Whether the 1-based line of the file is in one of the ranges."""
    return any(start <= line <= end for start, end in ranges.get(file, []))


def describe(original, value):
    """The change in a few words: '> -> >=', or 'remove foo()' when the code is dropped."""
    original = " ".join(original.split())
    value = " ".join(value.split())
    text = f"remove {original}" if not value else f"{original} -> {value}"
    return text if len(text) <= MAX_CHANGE else text[: MAX_CHANGE - 3] + "..."


def row(file, line, status, original, value):
    return f"{file}:{line}  {status}: {describe(original, value)}"


def summarize(results):
    """(rows, tally) from (file, line, status, original, value) tuples; status is
    killed, lived or timeout. Rows are by file and line, one per distinct change."""
    caught = 0
    rows = set()
    sort = {}
    for file, line, status, original, value in results:
        if status == "killed":
            caught += 1
            continue
        text = row(file, line, status, original, value)
        rows.add(text)
        sort[text] = (file, line)
    ordered = sorted(rows, key=lambda text: (sort[text], text))
    return ordered, f"{caught} of {caught + len(ordered)}"


def write_results(out, rows, tally):
    out.mkdir(parents=True, exist_ok=True)
    (out / "lived.txt").write_text("".join(f"{text}\n" for text in rows), "utf-8")
    (out / "tally.txt").write_text(f"{tally}\n", "utf-8")


def range_filter(base, ranges, prefix):
    """A vertigo-rs filter (a `base` subclass) that keeps one copy of each change that
    starts on a requested line. `prefix` turns a project path into a repository path."""

    class RangeFilter(base):
        def apply(self, mutations):
            seen = set()
            kept = []
            for mutation in mutations:
                file = prefix + mutation.relative_path
                key = (file, tuple(mutation.location), mutation.value)
                if key in seen or not in_ranges(ranges, file, mutation.line_number + 1):
                    continue
                seen.add(key)
                kept.append(mutation)
            return kept

    return RangeFilter()


def collect(mutations, project, MutationResult):
    """Each mutation as a result tuple. Changes that don't compile or are the same
    program as the original aren't counted: no test could be expected to catch them."""
    names = {
        MutationResult.KILLED: "killed",
        MutationResult.LIVED: "lived",
        MutationResult.TIMEDOUT: "timeout",
    }
    results = []
    skipped = 0
    for mutation in mutations:
        status = names.get(mutation.result)
        if status is None:
            skipped += 1
            continue
        results.append(
            (
                f"{project}/{mutation.relative_path}",
                mutation.line_number + 1,
                status,
                mutation.original_value,
                mutation.value,
            )
        )
    return results, skipped


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--ranges", required=True, help="file:from-to,... in the repository")
    parser.add_argument("--out", default="build/mutants", help="where lived.txt and tally.txt go")
    parser.add_argument("--project", default="evm", help="the Foundry project directory")
    args = parser.parse_args(argv)
    out = Path(args.out)
    if not out.is_absolute():
        out = Path.cwd() / out
    ranges = parse_ranges(args.ranges)
    project = ROOT / args.project

    # vertigo-rs is imported here so the helpers above work without it.
    from eth_vertigo.core import MutationResult
    from eth_vertigo.core.filter import MutationFilter
    from eth_vertigo.core.network import StaticNetworkPool
    from eth_vertigo.interfaces.foundry import FoundryCampaign

    prefix = f"{args.project}/"

    # Files vertigo-rs reads the contracts' syntax trees of, relative to the project.
    scope = sorted({file.removeprefix(prefix) for file in ranges if file.startswith(prefix)})
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        handle.write("\n".join(scope) + "\n")
    os.chdir(project)
    try:
        campaign = FoundryCampaign(
            src_dir="src",
            exclude_regex="(?!)",
            scope_file=handle.name,
            foundry_command=["forge"],
            project_directory=project,
            mutators=[],
            network_pool=StaticNetworkPool(["_not_used_anywhere_"]),
            filters=[range_filter(MutationFilter, ranges, prefix)],
            suggesters=[],
        )
        campaign.setup()
        print(f"{len(campaign.mutations)} changes on {sum(len(r) for r in ranges.values())} ranges.")
        if campaign.mutations:
            if not campaign.valid():
                print("The tests don't pass on the unchanged contract.", file=sys.stderr)
                return 1
            campaign.store_compilation_results()
            campaign.run(lambda: None, threads=1)
    finally:
        os.unlink(handle.name)

    results, skipped = collect(campaign.mutations, args.project, MutationResult)
    rows, tally = summarize(results)
    for text in rows:
        print(text)
    print(f"{tally} changes caught by a test." + (f" {skipped} didn't compile or kept the same bytecode." if skipped else ""))
    write_results(out, rows, tally)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
