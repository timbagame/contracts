// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.37;
import {Test} from "forge-std/Test.sol";
import {Upgrade} from "../script/Upgrade.s.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ContractAuthority} from "./ContractAuthority.sol";

contract UpgradeTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    Upgrade private script;
    ContractAuthority private safe;
    Timba private proxy;

    function setUp() public {
        script = new Upgrade();
        safe = new ContractAuthority();
        proxy = deployProxy(address(safe));
    }

    function deployProxy(address authority) private returns (Timba) {
        return Timba(
            address(
                new ERC1967Proxy(
                    address(new Timba()),
                    abi.encodeCall(
                        Timba.initialize,
                        (makeAddr("operator"), authority, Timba.OracleConfig(1, 1 hours, 5 minutes, 1 days, 100))
                    )
                )
            )
        );
    }

    function implementationOf(Timba timba) private view returns (address) {
        return address(uint160(uint256(vm.load(address(timba), IMPLEMENTATION_SLOT))));
    }

    /// @dev Each test writes its own file; tests run in parallel.
    function file(string memory name) private pure returns (string memory) {
        return string.concat("test-", name, ".json");
    }

    function path(string memory name) private pure returns (string memory) {
        return string.concat("safe-batches/", file(name));
    }

    /// Executes a written batch the way the Safe would, and checks it matches its checksum.
    function executeBatch(ContractAuthority authority, string memory written) private {
        string memory json = vm.readFile(written);
        vm.removeFile(written);
        address to = vm.parseJsonAddress(json, ".transactions[0].to");
        bytes memory data = vm.parseJsonBytes(json, ".transactions[0].data");
        assertEq(vm.parseJsonString(json, ".transactions[0].value"), "0");
        assertEq(vm.parseJsonString(json, ".version"), "1.0");
        assertEq(vm.parseJsonString(json, ".chainId"), vm.toString(block.chainid));
        assertEq(vm.parseJsonAddress(json, ".meta.createdFromSafeAddress"), address(authority));
        assertEq(
            vm.parseJsonBytes32(json, ".meta.checksum"),
            script.checksum(
                vm.parseJsonString(json, ".chainId"),
                vm.parseJsonUint(json, ".createdAt"),
                address(authority),
                vm.parseJsonString(json, ".meta.description"),
                to,
                data
            )
        );
        authority.execute(to, data);
    }

    function testWritesASafeBatchThatUpgradesTheProxy() public {
        address previous = implementationOf(proxy);
        address next = address(new Timba());

        string memory written = script.upgrade(proxy, next, file("upgrade"));

        // Writing the batch only simulates the upgrade.
        assertEq(written, path("upgrade"));
        assertEq(implementationOf(proxy), previous);
        executeBatch(safe, written);
        assertEq(implementationOf(proxy), next);
        assertEq(proxy.upgradeAuthority(), address(safe));
        assertEq(proxy.owner(), makeAddr("operator"));
    }

    function testHandsTheAuthorityToAnotherSafeInTwoSteps() public {
        ContractAuthority next = new ContractAuthority();
        vm.expectRevert(Upgrade.NoPendingUpgradeAuthority.selector);
        script.acceptAuthority(proxy, file("accept-none"));

        executeBatch(safe, script.proposeAuthority(proxy, address(next), file("propose")));
        assertEq(proxy.pendingUpgradeAuthority(), address(next));
        assertEq(proxy.upgradeAuthority(), address(safe));

        executeBatch(next, script.acceptAuthority(proxy, file("accept")));
        assertEq(proxy.upgradeAuthority(), address(next));
        assertEq(proxy.pendingUpgradeAuthority(), address(0));

        // The old Safe can no longer upgrade.
        address implementation = address(new Timba());
        vm.prank(address(safe));
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        proxy.upgradeToAndCall(implementation, "");
    }

    function testRefusesBatchesThatCouldNotExecute() public {
        // A key, not a Safe, holds the authority.
        Timba keyed = deployProxy(makeAddr("authority"));
        address implementation = address(new Timba());
        vm.expectRevert(abi.encodeWithSelector(Upgrade.NotAContract.selector, makeAddr("authority")));
        script.upgrade(keyed, implementation, file("keyed"));

        vm.expectRevert(abi.encodeWithSelector(Upgrade.NotAContract.selector, makeAddr("nothing")));
        script.upgrade(proxy, makeAddr("nothing"), file("nothing"));

        // The rehearsal as the Safe reverts: the target is not an upgradeable implementation.
        vm.expectRevert(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(safe)));
        script.upgrade(proxy, address(safe), file("not-uups"));
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        script.proposeAuthority(proxy, address(proxy), file("self"));
        assertFalse(vm.exists(path("keyed")));
        assertFalse(vm.exists(path("not-uups")));
    }

    function testMatchesTheTransactionBuilderChecksum() public view {
        // Computed with the Transaction Builder 1.18.3 algorithm (apps/tx-builder/src/lib/checksum.ts).
        assertEq(
            script.checksum(
                "1",
                1_700_000_000_000,
                0x000000000000000000000000000000000000dEaD,
                "Upgrade the Timba proxy",
                0x0000000000000000000000000000000000001234,
                hex"4f1ef286"
            ),
            0xc124372fcf13a686adc7a004e06e31560d7a0989aa040f6787868973e009a016
        );
    }

    function testReadsTheProxyAndImplementationFromTheEnvironment() public {
        // The only test that sets these variables, since tests share the process environment.
        ContractAuthority next = new ContractAuthority();
        address implementation = address(new Timba());
        vm.setEnv("TIMBA_PROXY", vm.toString(address(proxy)));
        vm.setEnv("TIMBA_IMPLEMENTATION", vm.toString(implementation));
        vm.setEnv("TIMBA_SAFE_BATCH", file("env"));

        executeBatch(safe, script.run());
        executeBatch(safe, script.propose(address(next)));
        executeBatch(next, script.accept());

        assertEq(implementationOf(proxy), implementation);
        assertEq(proxy.upgradeAuthority(), address(next));
    }
}
