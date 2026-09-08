// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract VectorToken is ERC20 {
    constructor() ERC20("Vector only", "VEC") {}

    function mint(address to) external {
        _mint(to, 10000);
    }
}

/// @dev Local-only deterministic vectors. No broadcast or real keys.
contract ClientVectors is Script {
    address constant creator = address(0x200);
    address constant player = address(0x300);

    function deploy() private returns (Timba t) {
        Timba impl = new Timba();
        ERC1967Proxy template = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Timba.initialize, (vm.addr(0xa11ce), address(0xad), Timba.OracleConfig(1, 10, 1, 1000, 100)))
        );
        t = Timba(address(0x100));
        vm.etch(address(t), address(template).code);
        vm.store(
            address(t),
            bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1),
            bytes32(uint256(uint160(address(impl))))
        );
        t.initialize(vm.addr(0xa11ce), address(0xad), Timba.OracleConfig(1, 10, 1, 1000, 100));
        VectorToken templateToken = new VectorToken();
        VectorToken token = VectorToken(address(0x400));
        vm.etch(address(token), address(templateToken).code);
        token.mint(creator);
        token.mint(player);
        vm.prank(creator);
        token.approve(address(t), type(uint256).max);
        vm.prank(player);
        token.approve(address(t), type(uint256).max);
    }

    function generate() public returns (string memory result) {
        vm.chainId(8453);
        vm.warp(1000);
        vm.roll(42);
        Timba t = deploy();
        bytes32 secret = bytes32(uint256(42));
        bytes32 commitment = sha256(abi.encodePacked(secret));
        Timba.CreateRequest memory r = Timba.CreateRequest(
            creator, address(0x400), Timba.GameType.Coinflip, 123, 2, 3, 100, false, commitment, 0, 2000
        );
        bytes32 digest = t.creationDigest(r);
        bytes32 gameId;
        {
            (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xa11ce, digest);
            vm.prank(creator);
            gameId = t.createGame(r, abi.encodePacked(rr, s, v), true);
        }
        vm.prank(player);
        t.joinGame(gameId, 0, "");
        string memory key = "client-vector-v1";
        vm.serializeString(key, "chainId", "8453");
        vm.serializeAddress(key, "proxy", address(t));
        vm.serializeAddress(key, "creator", creator);
        vm.serializeAddress(key, "player", player);
        vm.serializeAddress(key, "token", address(0x400));
        vm.serializeString(key, "secret", vm.toString(secret));
        vm.serializeString(key, "commitment", vm.toString(commitment));
        vm.serializeString(key, "creationDigest", vm.toString(digest));
        vm.serializeString(key, "gameId", vm.toString(gameId));
        vm.serializeString(key, "joinDigest", vm.toString(t.joinDigest(gameId, player, 2000)));
        vm.serializeString(key, "winnerIndex", vm.toString(t.winnerIndex(gameId, secret)));
        vm.serializeString(key, "createCalldata", vm.toString(abi.encodeCall(Timba.createGame, (r, hex"1234", true))));
        vm.serializeString(key, "joinCalldata", vm.toString(abi.encodeCall(Timba.joinGame, (gameId, 2000, hex"1234"))));
        vm.serializeString(key, "refundCalldata", vm.toString(abi.encodeCall(Timba.refundPlayer, (gameId, player))));
        vm.serializeString(key, "completeCalldata", vm.toString(abi.encodeCall(Timba.completeGame, (gameId, secret))));
        result = vm.serializeString(key, "closeCalldata", vm.toString(abi.encodeCall(Timba.closeGame, (gameId))));
    }

    function run() external {
        console2.log("CLIENT_VECTOR", generate());
    }
}
