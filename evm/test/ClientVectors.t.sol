// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {ClientVectors} from "../script/ClientVectors.s.sol";
import {Timba} from "../src/Timba.sol";

contract ClientVectorsTest is Test {
    function testClientVectorsMatchContract() public {
        string memory generated = new ClientVectors().generate();
        string memory expected = vm.readFile("test/fixtures/client-v1.json");
        assertEq(vm.parseJson(generated), vm.parseJson(expected));
    }

    function testRunBuildsFixtureGameOnBaseChain() public {
        string memory expected = vm.readFile("test/fixtures/client-v1.json");
        Timba proxy = Timba(vm.parseJsonAddress(expected, ".proxy"));
        bytes32 gameId = vm.parseJsonBytes32(expected, ".gameId");

        new ClientVectors().run();

        assertEq(block.chainid, 8453);
        Timba.Game memory game = proxy.getGame(gameId);
        assertEq(uint256(game.status), uint256(Timba.Status.Open));
        assertEq(game.token, vm.parseJsonAddress(expected, ".token"));
        assertEq(game.commitment, vm.parseJsonBytes32(expected, ".commitment"));
        assertEq(game.participants.length, 2);
        assertEq(game.participants[0], vm.parseJsonAddress(expected, ".creator"));
        assertEq(game.participants[1], vm.parseJsonAddress(expected, ".player"));
        assertEq(game.totalAmount, 246);
        assertEq(proxy.winnerIndex(gameId, vm.parseJsonBytes32(expected, ".secret")), 1);
    }
}
