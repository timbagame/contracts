// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;

/// @dev Stands in for a Safe: a contract that executes the calls its owners approved.
contract ContractAuthority {
    function execute(address to, bytes calldata data) external {
        (bool ok, bytes memory reason) = to.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
    }
}
