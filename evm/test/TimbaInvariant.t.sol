// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Token} from "./Timba.t.sol";

contract GameHandler is Test {
    Timba public timba;
    Token public token;
    uint256 constant OP_KEY = 0xa11ce;
    address public operator = vm.addr(OP_KEY);
    bytes32 constant SECRET = keccak256("invariant secret");
    bytes32[] public ids;
    address[4] public players = [address(101), address(102), address(103), address(104)];

    constructor(Timba t, Token asset) {
        timba = t;
        token = asset;
        for (uint256 i; i < 4; i++) {
            token.mint(players[i], 1_000_000 ether);
            vm.prank(players[i]);
            token.approve(address(t), type(uint256).max);
        }
    }

    function create(uint256 kind, uint256 creatorIndex, uint96 rawAmount) external {
        if (ids.length >= 20) return;
        address creator = players[creatorIndex % 4];
        uint256 amount = bound(uint256(rawAmount), 1, 1 ether);
        Timba.CreateRequest memory r = Timba.CreateRequest(
            creator,
            address(token),
            Timba.GameType(kind % 2),
            amount,
            2,
            4,
            60,
            false,
            sha256(abi.encodePacked(SECRET)),
            timba.creationNonces(creator),
            block.timestamp + 60
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(OP_KEY, timba.creationDigest(r));
        vm.prank(creator);
        ids.push(timba.createGame(r, abi.encodePacked(rr, s, v), true));
    }

    function join(uint256 index, uint256 playerIndex) external {
        if (ids.length == 0) return;
        bytes32 id = ids[index % ids.length];
        Timba.Game memory g = timba.getGame(id);
        address player = players[playerIndex % 4];
        if (
            g.status != Timba.Status.Open || block.timestamp >= g.expiresAt || g.participants.length == g.maxPlayers
                || timba.participantIndex(id, player) != 0
        ) return;
        vm.prank(player);
        timba.joinGame(id, 0, "");
    }

    function advance(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 120));
        vm.roll(block.number + 1);
    }

    function finish(uint256 index) external {
        if (ids.length == 0) return;
        bytes32 id = ids[index % ids.length];
        Timba.Game memory g = timba.getGame(id);
        if (g.status != Timba.Status.Open) return;
        uint256 count = g.participants.length;
        bool ready = count == g.maxPlayers || (count >= g.minPlayers && block.timestamp >= g.expiresAt);
        if (ready && block.timestamp < g.expiresAt + 60) {
            vm.prank(operator);
            timba.completeGame(id, SECRET);
        } else if (
            count == 0
                || (g.gameType == Timba.GameType.Giveaway
                    && block.timestamp >= g.expiresAt
                    && (!ready || block.timestamp >= g.expiresAt + 60))
        ) {
            vm.prank(g.creator);
            timba.closeGame(id);
        } else if (block.timestamp >= g.expiresAt && (!ready || block.timestamp >= g.expiresAt + 60)) {
            vm.prank(g.creator);
            timba.refundPlayer(id, g.participants[0]);
        }
    }

    function checkAccounting() external view {
        uint256 total;
        for (uint256 i; i < ids.length; i++) {
            Timba.Game memory g = timba.getGame(ids[i]);
            total += g.totalAmount;
            if (g.status == Timba.Status.Open) {
                if (g.gameType == Timba.GameType.Coinflip) {
                    assertEq(g.totalAmount, g.participants.length * g.ticketAmount);
                }
                for (uint256 j; j < g.participants.length; j++) {
                    assertEq(timba.participantIndex(ids[i], g.participants[j]), j + 1);
                }
            } else {
                assertEq(g.totalAmount, 0);
            }
        }
        assertEq(timba.liabilities(address(token)), total);
        assertEq(token.balanceOf(address(timba)), total);
        uint256 balances = total + token.balanceOf(operator);
        for (uint256 i; i < 4; i++) {
            balances += token.balanceOf(players[i]);
        }
        assertEq(balances, 4_000_000 ether);
    }
}

contract TimbaInvariantTest is Test {
    GameHandler internal handler;

    function setUp() public {
        vm.warp(100);
        address operator = vm.addr(0xa11ce);
        Timba t = Timba(
            address(
                new ERC1967Proxy(
                    address(new Timba()),
                    abi.encodeCall(Timba.initialize, (operator, operator, Timba.OracleConfig(1, 60, 1, 30 days, 100)))
                )
            )
        );
        Token asset = new Token();
        handler = new GameHandler(t, asset);
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = GameHandler.create.selector;
        selectors[1] = GameHandler.join.selector;
        selectors[2] = GameHandler.advance.selector;
        selectors[3] = GameHandler.finish.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariantFundsAndParticipantsRemainConsistent() public view {
        handler.checkAccounting();
    }
}
