# Local gas measurements

Measured with Foundry 1.8.1, Solidity 0.8.30, optimizer 200 runs, Cancun, and a fresh Anvil instance. These are mined execution gas units, not an L2 dollar-cost quote; token implementations, calldata/data-availability charges, and network pricing change the total cost. The two-player coinflip uses a conventional local test ERC-20 and a 1% fee.

| Transaction                  |  Gas used |
| ---------------------------- | --------: |
| `deploy Timba`               | 3,408,827 |
| `deploy ERC1967Proxy`        |   276,759 |
| `deploy SmokeToken`          |   567,574 |
| `approve(address,uint256)`   |    46,678 |
| `createGame + creator entry` |   369,244 |
| `approve(address,uint256)`   |    46,678 |
| `joinGame`                   |   123,003 |
| `deploy Timba`               | 3,408,827 |
| `upgradeToAndCall`           |    38,138 |
| `completeGame`               |    98,452 |

The maximum-capacity test creates a 1,000-player giveaway over separate joins and settles it without iterating over the participant list. Run `forge test --root evm --match-test testGasMaximumParticipants -vv` to see its settlement measurement. The test's total gas includes all 1,000 joins and is not the gas of a single production transaction.

Regenerate the local receipts with `bash evm/script/local-smoke.sh`; inspect `evm/broadcast/LocalSmoke.s.sol/31337/run-latest.json`. Run `forge test --root evm --gas-report` for the broader test suite's function measurements.
