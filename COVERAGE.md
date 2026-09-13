# Coverage gate

Both contract CI jobs require **85% weighted source line coverage**, with independent
scopes for `evm/src` and `solana/programs/timba/src`. Deployment scripts, test code
and third-party contracts do not inflate the on-chain implementation result.
Missing or empty reports and scoped source files absent from LCOV fail closed.

EVM uses `forge coverage`. Solana builds a separate debug-info SBF artifact after
the normal tests, enables LiteSVM register tracing only through the test harness's
`coverage` feature, and uses Anchor 1.2.0 `coverage --skip-run` to map real SBF
instruction execution to Rust source lines. Host coverage is not substituted.
Coverage builds are validation artifacts, not deployable release artifacts.

CI uploads LCOV even when the threshold fails. Existing below-threshold code must
gain behavioral tests; this PR does not lower thresholds or exempt runtime paths.

The checker runs from the repository root:

```sh
python3 scripts/check-coverage.py coverage-evm.json evm/coverage/lcov.info
python3 scripts/check-coverage.py coverage-solana.json solana/target/coverage/sbf.lcov
```

The declarations-only `instructions/mod.rs` is excluded because it contains no
executable implementation. All instruction implementations remain in scope.
