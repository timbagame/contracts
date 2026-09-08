// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SmokeToken is ERC20 {
    constructor(address alice, address bob) ERC20("Local test only", "TEST") {
        _mint(alice, 100 ether);
        _mint(bob, 100 ether);
    }
}

/// @dev Public test keys. Refuses to run on any chain ID other than Anvil's default.
contract LocalSmoke is Script {
    function run() external {
        require(block.chainid == 31337, "local smoke only");
        address operator = vm.addr(0xa11ce);
        address alice = vm.addr(0xb0b);
        address bob = vm.addr(0xcafe);
        vm.startBroadcast(0xa11ce);
        Timba t = Timba(
            address(
                new ERC1967Proxy(
                    address(new Timba()),
                    abi.encodeCall(Timba.initialize, (operator, operator, Timba.OracleConfig(1, 60, 1, 30 days, 100)))
                )
            )
        );
        SmokeToken token = new SmokeToken(alice, bob);
        vm.stopBroadcast();
        bytes32 secret = keccak256("local smoke secret");
        Timba.CreateRequest memory r = Timba.CreateRequest(
            alice,
            address(token),
            Timba.GameType.Coinflip,
            10 ether,
            2,
            2,
            1 hours,
            false,
            sha256(abi.encodePacked(secret)),
            0,
            block.timestamp + 1 hours
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xa11ce, t.creationDigest(r));
        vm.startBroadcast(0xb0b);
        token.approve(address(t), type(uint256).max);
        bytes32 id = t.createGame(r, abi.encodePacked(rr, s, v), true);
        vm.stopBroadcast();
        vm.startBroadcast(0xcafe);
        token.approve(address(t), type(uint256).max);
        t.joinGame(id, 0, "");
        vm.stopBroadcast();
        vm.startBroadcast(0xa11ce);
        t.upgradeToAndCall(address(new Timba()), "");
        t.completeGame(id, secret);
        vm.stopBroadcast();
        require(t.liabilities(address(token)) == 0, "outstanding funds");
        require(token.balanceOf(address(t)) == 0, "vault not empty");
        require(token.balanceOf(operator) == 0.2 ether, "wrong fee");
        require(t.getGame(id).status == Timba.Status.Completed, "not completed");
    }
}
