# Local gas measurements

Measured with Foundry 1.8.5, Solidity 0.8.37, optimizer 200 runs, Cancun, and a fresh Anvil instance. These are mined execution gas units, not an L2 dollar-cost quote; token implementations, calldata/data-availability charges, and network pricing change the total cost. The two-player coinflip uses a conventional local test ERC-20 and a 1% fee.

| Transaction                  |  Gas used |
| ---------------------------- | --------: |
| `deploy Timba`               | 3,414,717 |
| `deploy ERC1967Proxy`        |   276,759 |
| `deploy SmokeToken`          |   567,814 |
| `approve(address,uint256)`   |    46,678 |
| `createGame + creator entry` |   369,250 |
| `approve(address,uint256)`   |    46,678 |
| `joinGame`                   |   123,003 |
| `deploy Timba`               | 3,414,717 |
| `upgradeToAndCall`           |    38,138 |
| `completeGame`               |    98,496 |

The maximum-capacity test creates a 1,000-player giveaway over separate joins and settles it without iterating over the participant list. Run `forge test --match-test testGasMaximumParticipants -vv` to see its settlement measurement. The test's total gas includes all 1,000 joins and is not the gas of a single production transaction.

Regenerate the local receipts with `bash script/local-smoke.sh`; inspect `broadcast/LocalSmoke.s.sol/31337/run-latest.json`. Run `forge test --gas-report` for the broader test suite's function measurements.
