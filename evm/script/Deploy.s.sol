// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.38;
import {Script} from "forge-std/Script.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Deploys the proxy with a multisig (such as a Safe) as the upgrade authority.
contract Deploy is Script {
    /// The upgrade authority controls every escrowed token, so a single key may not hold it.
    error UpgradeAuthorityNotAContract(address authority);

    function run() external returns (Timba deployment) {
        address operator = vm.envAddress("TIMBA_OPERATOR");
        address authority = vm.envAddress("TIMBA_UPGRADE_AUTHORITY");
        if (authority.code.length == 0) revert UpgradeAuthorityNotAContract(authority);
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
