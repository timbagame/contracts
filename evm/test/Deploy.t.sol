// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Timba} from "../src/Timba.sol";

contract DeployTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function testDeploysInitializedProxyWithOperationalDefaults() public {
        address operator = makeAddr("operator");
        address authority = makeAddr("authority");
        vm.setEnv("TIMBA_OPERATOR", vm.toString(operator));
        vm.setEnv("TIMBA_UPGRADE_AUTHORITY", vm.toString(authority));

        Timba deployment = new Deploy().run();

        assertEq(deployment.owner(), operator);
        assertEq(deployment.upgradeAuthority(), authority);
        (uint8 fee, uint32 buffer, uint32 minTimeout, uint32 maxTimeout, uint32 maxPlayers) = deployment.config();
        assertEq(fee, 1);
        assertEq(buffer, 1 hours);
        assertEq(minTimeout, 5 minutes);
        assertEq(maxTimeout, 1 days);
        assertEq(maxPlayers, 100);
        address implementation = address(uint160(uint256(vm.load(address(deployment), IMPLEMENTATION_SLOT))));
        assertTrue(implementation != address(0) && implementation != address(deployment));
        vm.expectRevert();
        Timba(implementation).initialize(operator, authority, Timba.OracleConfig(1, 1 hours, 5 minutes, 1 days, 100));
    }

    function testRejectsMissingUpgradeAuthority() public {
        vm.setEnv("TIMBA_OPERATOR", vm.toString(makeAddr("operator")));
        vm.setEnv("TIMBA_UPGRADE_AUTHORITY", vm.toString(address(0)));
        Deploy script = new Deploy();
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        script.run();
    }
}
