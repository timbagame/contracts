// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {Timba} from "../src/Timba.sol";

/// @dev Review storage compatibility before broadcasting with the upgrade authority.
contract Upgrade is Script {
    function run() external {
        Timba proxy = Timba(vm.envAddress("TIMBA_PROXY"));
        address implementation = vm.envAddress("TIMBA_IMPLEMENTATION");
        vm.startBroadcast();
        proxy.upgradeToAndCall(implementation, "");
        vm.stopBroadcast();
    }
}
