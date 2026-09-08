// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {ClientVectors} from "../script/ClientVectors.s.sol";

contract ClientVectorsTest is Test {
    function testClientVectorsMatchContract() public {
        string memory generated = new ClientVectors().generate();
        string memory expected = vm.readFile("test/fixtures/client-v1.json");
        assertEq(vm.parseJson(generated), vm.parseJson(expected));
    }
}
