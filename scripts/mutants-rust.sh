#!/usr/bin/env bash
# Mutation testing for the Solana program's Rust: cargo-mutants changes the code in small
# ways, such as flipping a comparison or emptying a function, and runs the tests for each
# change. A change no test notices is a missed mutant.
# Only the program's pure logic is mutated, the code the host test (solana/programs/timba/
# tests/game_state.rs) and the unit tests reach without a validator or the SBF build:
# programs/timba/src/state.rs (see solana/.cargo/mutants.toml). The LiteSVM tests need the
# deployed program built with the Solana toolchain, which is too slow to run per change.
# Usage: scripts/mutants-rust.sh diff BASE [--out DIR]  mutants in the Rust lines changed since BASE
#        scripts/mutants-rust.sh shard K/N [--out DIR]  the Kth of N equal parts of every mutant
#        scripts/mutants-rust.sh summarize MUTANTS_OUT DIR
#        scripts/mutants-rust.sh found MUTANTS_OUT     fails when cargo-mutants listed no mutant at all
# Writes what lived to DIR/lived.txt ("file:line  missed: change") and the tally
# ("3 of 10") to DIR/tally.txt, the same files scripts/mutants.ts writes. DIR
# defaults to build/mutants. Exits 0 once it got to its tally, whatever lived;
# only a broken run fails. cargo-mutants' own output is in build/mutants-rust.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"
usage='Usage: scripts/mutants-rust.sh diff BASE | shard K/N [--out DIR] | summarize MUTANTS_OUT DIR | found MUTANTS_OUT'

# Turn cargo-mutants' mutants.out into lived.txt and tally.txt in a directory. Its paths
# are relative to the solana/ workspace; the rows' are relative to the repository.
summarize() {
    local from=$1 out=$2 caught lived
    mkdir -p "$out"
    lived=$({
        sed -E 's/^([^:]+):([0-9]+):[0-9]+: /solana\/\1:\2  missed: /' "$from/missed.txt" 2>/dev/null || true
        sed -E 's/^([^:]+):([0-9]+):[0-9]+: /solana\/\1:\2  timeout: /' "$from/timeout.txt" 2>/dev/null || true
    } | LC_ALL=C sort -t: -k1,1 -k2,2n | uniq)
    caught=$(grep -c . "$from/caught.txt" 2>/dev/null || true)
    caught=${caught:-0}
    if [[ -n $lived ]]; then printf '%s\n' "$lived" > "$out/lived.txt"; else : > "$out/lived.txt"; fi
    echo "$caught of $((caught + $(grep -c . <<< "$lived" || true)))" > "$out/tally.txt"
    [[ -z $lived ]] || printf '%s\n' "$lived"
    echo "$(< "$out/tally.txt") changes caught by a test."
}

# Fails when cargo-mutants found nothing to mutate. For a part of everything that means the
# setup is broken (the scope matches no file), not that every change was caught.
found() {
    local list
    list=$(tr -d '[:space:]' < "$1/mutants.json" 2>/dev/null || true)
    if [[ -z $list || $list == '[]' ]]; then
        echo "cargo-mutants found no mutant to test: check examine_globs in solana/.cargo/mutants.toml." >&2
        return 1
    fi
}

mode=${1:-}
if [[ $mode == found ]]; then
    found "${2:?$usage}"
    exit 0
fi
if [[ $mode == summarize ]]; then
    summarize "${2:?$usage}" "${3:?$usage}"
    exit 0
fi
if [[ $mode != diff && $mode != shard ]]; then
    echo "$usage" >&2
    exit 2
fi
version=27.1.0
out=build/mutants
if [[ ${3:-} == --out ]]; then out=${4:?$usage}; fi
# Absolute, because cargo-mutants runs in solana/.
[[ $out == /* ]] || out=$repo/$out
raw=$repo/build/mutants-rust
rm -rf "$raw"
mkdir -p "$raw"
if [[ $(cargo mutants --version 2>/dev/null) != "cargo-mutants $version" ]]; then
    # Unlocked, so it builds with crossbeam-epoch 0.9.20 or later: its lock
    # file pins 0.9.18 (RUSTSEC-2026-0204).
    cargo install cargo-mutants --version "$version"
fi
# Mutate the program's own package: the harness crate builds the same source through a
# "../programs/..." path that cargo-mutants would not match to the repository's paths. The
# harness crate compiles it for the host, and its --lib and game_state tests are the ones
# CI's host coverage step runs too.
args=(--package timba --test-package timba-test-harness --no-shuffle --output "$raw"
    --timeout "${MUTANTS_TIMEOUT:-300}"
    # Both the build and the test step build only the host tests: the LiteSVM tests include
    # the deployed program's build, which is not there. The test step adds game_state.
    --cargo-arg=--lib
    # The tests are run once on the unchanged code below instead.
    --baseline skip)
# A CI checkout is disposable: mutate it in place, so the restored build
# cache serves every mutant. Elsewhere cargo-mutants works on a copy.
if [[ -n ${CI:-} ]]; then args+=(--in-place); fi
case "$mode" in
    diff)
        base=${2:?$usage}
        diff="$raw/changes.diff"
        # Paths relative to solana/, as cargo-mutants reads them.
        git diff --relative=solana "$(git merge-base "$base" HEAD)" HEAD -- 'solana/*.rs' > "$diff"
        if [[ ! -s $diff ]]; then
            echo 'No Rust changes to mutate.'
            summarize "$raw/mutants.out" "$out"
            exit 0
        fi
        args+=(--in-diff "$diff")
        ;;
    shard)
        args+=(--shard "${2:?$usage}")
        ;;
esac
# A mutant can allocate forever. Without a limit it fills the runner's memory and
# GitHub shuts the runner down, which loses every mutant in the part. With one, the
# test aborts and the mutant counts as caught. Only test programs get the limit,
# not rustc. 8 GiB is half of a hosted runner.
if command -v prlimit >/dev/null; then
    export "CARGO_TARGET_$(uname -m | tr '[:lower:]' '[:upper:]')_UNKNOWN_LINUX_GNU_RUNNER=prlimit --as=$((8 << 30))"
fi
# Missed mutants (2) and timeouts (3) are findings. Anything else is a broken run.
status=0
# The tests must pass on the unchanged code, or cargo-mutants would count every change as
# unviable (a build error) or caught (a failing test) without telling.
(cd solana && cargo test --package timba-test-harness --lib --test game_state)
(cd solana && cargo mutants "${args[@]}" -- --lib --test game_state) || status=$?
if [[ $status != 0 && $status != 2 && $status != 3 ]]; then
    echo "cargo-mutants stopped (exit $status) before its tally." >&2
    exit "$status"
fi
if [[ $mode == shard ]]; then found "$raw/mutants.out"; fi
summarize "$raw/mutants.out" "$out"
