// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Deploy is Script {
    function run() external returns (Timba deployment) {
        address operator = vm.envAddress("TIMBA_OPERATOR");
        address authority = vm.envAddress("TIMBA_UPGRADE_AUTHORITY");
        // Operational defaults are intentionally below the contract ceilings.
        Timba.OracleConfig memory config = Timba.OracleConfig(1, 1 hours, 5 minutes, 1 days, 100);
        vm.startBroadcast();
        Timba implementation = new Timba();
        deployment = Timba(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(Timba.initialize, (operator, authority, config))
                )
            )
        );
        vm.stopBroadcast();
    }
}
