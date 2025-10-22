import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const WASM_DIR = join(__dirname, "game-math");
const WASM_JS = join(WASM_DIR, "game_math.js");
const WASM_BG = join(WASM_DIR, "game_math_bg.wasm");

function ensureBuilt(): void {
  if (existsSync(WASM_JS) && existsSync(WASM_BG)) {
    return;
  }

  mkdirSync(WASM_DIR, { recursive: true });

  const result = spawnSync(
    "wasm-pack",
    [
      "build",
      "crates/game-math",
      "--target",
      "nodejs",
      "--out-dir",
      WASM_DIR,
      "--",
      "--no-default-features",
      "--features",
      "wasm",
    ],
    { stdio: "inherit", cwd: join(__dirname, "..", "..") }
  );

  if (result.status !== 0) {
    throw new Error("Failed to build wasm bindings for game math");
  }
}

function loadModule(): any {
  ensureBuilt();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(WASM_JS);
  if (typeof mod.initSync === "function") {
    const bytes = readFileSync(WASM_BG);
    mod.initSync(bytes);
  }
  return mod;
}

let cached: any | undefined;

function getModule(): any {
  if (!cached) {
    cached = loadModule();
  }
  return cached;
}

export function wasmCalculateWinnerIndex(
  ticketsCount: number,
  secretKey: Uint8Array,
  lastSlot: bigint
): number {
  const module = getModule();
  return module.winner_index_from_secret(secretKey, lastSlot, ticketsCount);
}

export function wasmPayoutBreakdown(
  totalAmount: bigint,
  feePercentage: bigint
): [bigint, bigint] {
  const module = getModule();
  const result = module.payout_breakdown(totalAmount, feePercentage);
  const winnerAmount = BigInt(result[0]);
  const feeAmount = BigInt(result[1]);
  return [winnerAmount, feeAmount];
}
