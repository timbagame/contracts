#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
port="${TIMBA_SMOKE_PORT:-18545}"
# Let an occupied port fail rather than interacting with somebody else's node.
anvil --host 127.0.0.1 --port "$port" --silent > /tmp/timba-evm-anvil-"$$".log 2>&1 &
anvil_pid=$!
trap 'kill "$anvil_pid" 2>/dev/null || true; wait "$anvil_pid" 2>/dev/null || true; rm -f /tmp/timba-evm-anvil-"$$".log' EXIT
rpc="http://127.0.0.1:$port"
for attempt in {1..50}; do
  kill -0 "$anvil_pid" 2>/dev/null || { cat /tmp/timba-evm-anvil-"$$".log; exit 1; }
  if cast chain-id --rpc-url "$rpc" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
kill -0 "$anvil_pid"
for key in a11ce b0b cafe; do
  padded=$(printf '%064s' "$key" | tr ' ' 0)
  account=$(cast wallet address --private-key "$padded")
  cast rpc --rpc-url "$rpc" anvil_setBalance "$account" 0x3635c9adc5dea00000 >/dev/null
done
forge script script/LocalSmoke.s.sol:LocalSmoke --rpc-url "$rpc" --broadcast --slow
# Verify mined receipts, not just Forge's pre-broadcast simulation.
bun -e '
const run = await Bun.file("broadcast/LocalSmoke.s.sol/31337/run-latest.json").json();
const valid =
  Array.isArray(run.receipts) &&
  run.receipts.length === 10 &&
  run.receipts.every((receipt) => receipt.status === "0x1");
if (!valid) {
  throw new Error("Expected 10 successful mined transactions.");
}
console.log("Verified 10 successful mined transactions.");
'
