// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.38;
import {Script} from "forge-std/Script.sol";
import {Timba} from "../src/Timba.sol";

/// @notice Writes Safe Transaction Builder batches to `safe-batches/` for the Safe that holds the
/// upgrade authority. Import the file in the Safe app's Transaction Builder; its owners then sign
/// and execute it. `TIMBA_SAFE_BATCH` overrides the file name.
/// @dev Every call is first run as the Safe on a discarded state snapshot, so a batch that would
/// revert is never written. Review storage compatibility before upgrading.
contract Upgrade is Script {
    error NotAContract(address account);
    error NoPendingUpgradeAuthority();

    string private constant DIRECTORY = "safe-batches/";

    /// @dev One call for `safe` to make.
    struct Batch {
        address safe;
        address to;
        bytes data;
        string name;
        string description;
    }

    /// @notice Upgrades `TIMBA_PROXY` to `TIMBA_IMPLEMENTATION`.
    function run() external returns (string memory) {
        return upgrade(proxy(), vm.envAddress("TIMBA_IMPLEMENTATION"), fileName("upgrade.json"));
    }

    /// @notice Has the current Safe propose `next` as the upgrade authority.
    function propose(address next) external returns (string memory) {
        return proposeAuthority(proxy(), next, fileName("propose-upgrade-authority.json"));
    }

    /// @notice Has the proposed Safe accept the upgrade authority.
    function accept() external returns (string memory) {
        return acceptAuthority(proxy(), fileName("accept-upgrade-authority.json"));
    }

    function upgrade(Timba timba, address implementation, string memory file) public returns (string memory) {
        if (implementation.code.length == 0) revert NotAContract(implementation);
        return write(
            Batch(
                timba.upgradeAuthority(),
                address(timba),
                abi.encodeCall(timba.upgradeToAndCall, (implementation, "")),
                "Upgrade Timba",
                string.concat("Upgrade the Timba proxy to implementation ", vm.toString(implementation))
            ),
            file
        );
    }

    function proposeAuthority(Timba timba, address next, string memory file) public returns (string memory) {
        return write(
            Batch(
                timba.upgradeAuthority(),
                address(timba),
                abi.encodeCall(timba.proposeUpgradeAuthority, (next)),
                "Propose Timba upgrade authority",
                string.concat("Propose ", vm.toString(next), " as the Timba upgrade authority")
            ),
            file
        );
    }

    function acceptAuthority(Timba timba, string memory file) public returns (string memory) {
        address pending = timba.pendingUpgradeAuthority();
        if (pending == address(0)) revert NoPendingUpgradeAuthority();
        return write(
            Batch(
                pending,
                address(timba),
                abi.encodeCall(timba.acceptUpgradeAuthority, ()),
                "Accept Timba upgrade authority",
                "Accept the Timba upgrade authority"
            ),
            file
        );
    }

    /// @notice The `meta.checksum` the Transaction Builder (1.18.3) expects, so it imports the
    /// file without a "modified" warning. It hashes its own key-sorted serialization of the batch,
    /// with the name replaced by null and the checksum left out.
    function checksum(
        string memory chainId,
        uint256 createdAt,
        address safe,
        string memory description,
        address to,
        bytes memory data
    ) public pure returns (bytes32) {
        return keccak256(
            bytes(
                string.concat(
                    '{["chainId","createdAt","meta","transactions","version"]"',
                    chainId,
                    '",',
                    vm.toString(createdAt),
                    ',{["createdFromSafeAddress","description","name"]"',
                    vm.toString(safe),
                    '","',
                    description,
                    '",null,},[{["data","to","value"]"',
                    vm.toString(data),
                    '","',
                    vm.toString(to),
                    '","0",}],"1.0",}'
                )
            )
        );
    }

    function proxy() private view returns (Timba) {
        return Timba(vm.envAddress("TIMBA_PROXY"));
    }

    function fileName(string memory name) private view returns (string memory) {
        return vm.envOr("TIMBA_SAFE_BATCH", name);
    }

    /// @return path The written file.
    function write(Batch memory call, string memory file) private returns (string memory path) {
        rehearse(call.safe, call.to, call.data);
        string memory chainId = vm.toString(block.chainid);
        uint256 createdAt = vm.unixTime();
        string memory batch = string.concat(
            '{"version":"1.0","chainId":"',
            chainId,
            '","createdAt":',
            vm.toString(createdAt),
            ',"meta":',
            meta(call, checksum(chainId, createdAt, call.safe, call.description, call.to, call.data)),
            ',"transactions":[{"to":"',
            vm.toString(call.to),
            '","value":"0","data":"',
            vm.toString(call.data),
            '"}]}'
        );
        vm.createDir(DIRECTORY, true);
        path = string.concat(DIRECTORY, file);
        vm.writeFile(path, batch);
    }

    /// @dev Runs the call as the Safe, then discards its effects. Reverts with the call's reason.
    function rehearse(address safe, address to, bytes memory data) private {
        if (safe.code.length == 0) revert NotAContract(safe);
        uint256 snapshot = vm.snapshotState();
        vm.prank(safe);
        (bool ok, bytes memory reason) = to.call(data);
        vm.revertToState(snapshot);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
    }

    function meta(Batch memory call, bytes32 sum) private pure returns (string memory) {
        return string.concat(
            '{"name":"',
            call.name,
            '","description":"',
            call.description,
            '","createdFromSafeAddress":"',
            vm.toString(call.safe),
            '","checksum":"',
            vm.toString(sum),
            '"}'
        );
    }
}
