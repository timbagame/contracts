// @ts-check
// Mutation testing: Stryker changes the code in small ways and runs the tests that reach each
// change. Run it through scripts/mutants.ts, which picks the lines to change.
import { readdirSync } from "node:fs";

// The coverage gates' tests, scripts/*.test.ts. The tests of the mutation setup itself, and
// solana/tests (they need a local validator), are left out.
const testFiles = readdirSync("scripts")
  .filter((name) => name.endsWith(".test.ts") && !name.startsWith("mutants"))
  .map((name) => `scripts/${name}`);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  // timeout bounds only the dry run, the whole suite once with coverage. Its default of 10 s
  // is too short, so it's set well above the suite's time in CI. Mutant runs use Stryker's own
  // per-mutant timeout.
  bun: {
    // Instrumentation slows individual tests; the runner still stops hanging mutants.
    bunArgs: ["--timeout", "60000"],
    timeout: 600000,
    testFiles,
  },
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // A mutant that loops forever is stopped and counted as timed out.
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
