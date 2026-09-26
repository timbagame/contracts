// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {Upgrade} from "../script/Upgrade.s.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract UpgradeTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

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

    function implementationOf(Timba proxy) private view returns (address) {
        return address(uint160(uint256(vm.load(address(proxy), IMPLEMENTATION_SLOT))));
    }

    function testUpgradesProxyToConfiguredImplementation() public {
        // The script broadcasts from the default sender, which must hold the upgrade authority.
        Timba proxy = deployProxy(tx.origin);
        address next = address(new Timba());
        vm.setEnv("TIMBA_PROXY", vm.toString(address(proxy)));
        vm.setEnv("TIMBA_IMPLEMENTATION", vm.toString(next));

        new Upgrade().run();

        assertEq(implementationOf(proxy), next);
        assertEq(proxy.upgradeAuthority(), tx.origin);
        assertEq(proxy.owner(), makeAddr("operator"));
    }

    function testRejectsBroadcasterWithoutUpgradeAuthority() public {
        Timba proxy = deployProxy(makeAddr("authority"));
        address previous = implementationOf(proxy);
        vm.setEnv("TIMBA_PROXY", vm.toString(address(proxy)));
        vm.setEnv("TIMBA_IMPLEMENTATION", vm.toString(address(new Timba())));
        Upgrade script = new Upgrade();

        vm.expectRevert(Timba.InvalidAuthorization.selector);
        script.run();
        assertEq(implementationOf(proxy), previous);
    }
}
