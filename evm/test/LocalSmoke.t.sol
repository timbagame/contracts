// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {LocalSmoke} from "../script/LocalSmoke.s.sol";

contract LocalSmokeTest is Test {
    function testCompletesLifecycleAndPaysFeeOnAnvilChain() public {
        assertEq(block.chainid, 31337);
        // run() reverts unless the vault is drained, the 0.2 ether fee is paid and the game completes.
        new LocalSmoke().run();
    }

    function testRefusesNonLocalChain() public {
        vm.chainId(1);
        LocalSmoke script = new LocalSmoke();
        vm.expectRevert(bytes("local smoke only"));
        script.run();
    }
}
