// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Timba} from "../src/Timba.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract Token is ERC20 {
    constructor() ERC20("Test", "TST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TaxToken is Token {
    bool public tax;

    function setTax(bool enabled) external {
        tax = enabled;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (tax && from != address(0) && to != address(0)) {
            super._update(from, address(0), amount / 10);
            amount -= amount / 10;
        }
        super._update(from, to, amount);
    }
}

contract CallbackToken is Token {
    Timba public target;
    bytes32 public game;
    bool public blocked;

    function arm(Timba t, bytes32 id) external {
        target = t;
        game = id;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (address(target) != address(0)) {
            try target.joinGame(game, 0, "") {
                revert("reentered");
            } catch {
                blocked = true;
            }
        }
        return super.transferFrom(from, to, amount);
    }
}

contract OperatorWallet is IERC1271 {
    bytes32 public approved;

    function approveDigest(bytes32 digest) external {
        approved = digest;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return digest == approved ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    function accept(Timba t) external {
        t.acceptOwnership();
    }
}

contract TimbaV2 is Timba {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract TimbaTest is Test {
    Timba internal timba;
    Token internal token;
    uint256 internal constant OP_KEY = 0xa11ce;
    address internal operator;
    address internal alice = address(0xa1);
    address internal bob = address(0xb1);
    bytes32 internal constant SECRET = keccak256("test secret");

    function setUp() public {
        vm.warp(1_000);
        vm.roll(50);
        operator = vm.addr(OP_KEY);
        timba = Timba(
            address(
                new ERC1967Proxy(
                    address(new Timba()), abi.encodeCall(Timba.initialize, (operator, address(0xad), defaults()))
                )
            )
        );
        token = new Token();
        fund(alice, token);
        fund(bob, token);
    }

    function defaults() internal pure returns (Timba.OracleConfig memory) {
        return Timba.OracleConfig(1, 1 hours, 1, 30 days, 1_000);
    }

    function fund(address user, Token asset) internal {
        asset.mint(user, 1_000_000 ether);
        vm.prank(user);
        asset.approve(address(timba), type(uint256).max);
    }

    function request(Timba.GameType kind) internal view returns (Timba.CreateRequest memory) {
        return Timba.CreateRequest(
            alice,
            address(token),
            kind,
            100 ether,
            2,
            2,
            1 hours,
            false,
            sha256(abi.encodePacked(SECRET)),
            timba.creationNonces(alice),
            block.timestamp + 100
        );
    }

    function sign(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OP_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function create(Timba.CreateRequest memory r, bool joinCreator) internal returns (bytes32) {
        bytes memory signature = sign(timba.creationDigest(r));
        vm.prank(alice);
        return timba.createGame(r, signature, joinCreator);
    }

    function join(bytes32 game, address player) internal {
        vm.prank(player);
        timba.joinGame(game, 0, "");
    }

    function testInitializationAndUpgradeAuthorization() public {
        Timba implementation = new Timba();
        vm.expectRevert();
        implementation.initialize(operator, address(0xad), defaults());
        vm.expectRevert();
        timba.initialize(operator, address(0xad), defaults());
        TimbaV2 next = new TimbaV2();
        vm.expectRevert();
        implementation.upgradeToAndCall(address(next), "");
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.upgradeToAndCall(address(next), "");
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.upgradeToAndCall(address(next), "");
        vm.prank(address(0xad));
        vm.expectRevert();
        timba.upgradeToAndCall(address(token), "");
        vm.prank(address(0xad));
        timba.upgradeToAndCall(address(next), "");
        assertEq(TimbaV2(address(timba)).version(), 2);
    }

    function testUpgradePreservesLiveGamesSignaturesAndRecovery() public {
        bytes32 full = create(request(Timba.GameType.Coinflip), true);
        join(full, bob);
        bytes32 underfilled = create(request(Timba.GameType.Coinflip), true);
        Timba.CreateRequest memory pending = request(Timba.GameType.Giveaway);
        bytes32 digest = timba.creationDigest(pending);
        bytes memory authorization = sign(digest);
        bytes32 beforeGame = keccak256(abi.encode(timba.getGame(full)));
        (, bytes memory beforeConfig) = address(timba).staticcall(abi.encodeWithSignature("config()"));
        uint256 winner = timba.winnerIndex(full, SECRET);
        TimbaV2 next = new TimbaV2();
        vm.prank(address(0xad));
        timba.upgradeToAndCall(address(next), "");
        assertEq(keccak256(abi.encode(timba.getGame(full))), beforeGame);
        (, bytes memory afterConfig) = address(timba).staticcall(abi.encodeWithSignature("config()"));
        assertEq(afterConfig, beforeConfig);
        assertEq(timba.owner(), operator);
        assertEq(timba.upgradeAuthority(), address(0xad));
        assertEq(timba.creationDigest(pending), digest);
        assertEq(timba.creationNonces(alice), 2);
        assertEq(timba.liabilities(address(token)), 300 ether);
        assertEq(token.balanceOf(address(timba)), 300 ether);
        assertEq(timba.participantIndex(full, alice), 1);
        assertEq(timba.participantIndex(full, bob), 2);
        assertEq(timba.winnerIndex(full, SECRET), winner);
        vm.prank(alice);
        bytes32 giveaway = timba.createGame(pending, authorization, false);
        vm.prank(operator);
        timba.completeGame(full, SECRET);
        vm.warp(timba.getGame(underfilled).expiresAt);
        vm.prank(alice);
        timba.refundPlayer(underfilled, alice);
        vm.prank(alice);
        timba.closeGame(giveaway);
        assertEq(timba.liabilities(address(token)), 0);
        assertEq(token.balanceOf(address(timba)), 0);
    }

    function testTwoStepUpgradeAuthorityIndependentOfOperator() public {
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.proposeUpgradeAuthority(bob);
        vm.prank(address(0xad));
        timba.proposeUpgradeAuthority(bob);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.acceptUpgradeAuthority();
        vm.prank(bob);
        timba.acceptUpgradeAuthority();
        assertEq(timba.upgradeAuthority(), bob);
        assertEq(timba.pendingUpgradeAuthority(), address(0));
        vm.prank(operator);
        timba.transferOwnership(alice);
        vm.prank(alice);
        timba.acceptOwnership();
        TimbaV2 next = new TimbaV2();
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.upgradeToAndCall(address(next), "");
        vm.prank(address(0xad));
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.upgradeToAndCall(address(next), "");
        vm.prank(bob);
        timba.upgradeToAndCall(address(next), "");
        assertEq(timba.owner(), alice);
    }

    function testSharedLifecycleAndFeeVectors() public {
        string[] memory rows = vm.split(vm.readFile("../fixtures/lifecycle.csv"), "\n");
        for (uint256 i = 1; i < rows.length; i++) {
            if (bytes(rows[i]).length == 0) continue;
            uint256 snapshot = vm.snapshotState();
            string[] memory columns = vm.split(rows[i], ",");
            uint256[] memory v = new uint256[](columns.length);
            for (uint256 j; j < columns.length; j++) {
                v[j] = vm.parseUint(columns[j]);
            }
            vm.warp(1_000);
            vm.prank(operator);
            timba.configure(Timba.OracleConfig(uint8(v[8]), 10, 1, 30 days, 1_000));
            Timba.CreateRequest memory r = request(Timba.GameType(v[0]));
            r.amount = v[7];
            r.minPlayers = uint32(v[2]);
            r.maxPlayers = uint32(v[3]);
            r.timeout = 100;
            bytes32 game = create(r, false);
            for (uint256 j; j < v[1]; j++) {
                address player = address(uint160(0x100 + j));
                fund(player, token);
                join(game, player);
                vm.prank(player);
                vm.expectRevert(Timba.EntryUnavailable.selector);
                timba.joinGame(game, 0, "");
            }
            vm.warp(v[4]);
            uint256 beforeFee = token.balanceOf(operator);
            uint256 beforeSettlement = vm.snapshotState();
            vm.prank(operator);
            (bool settled,) = address(timba).call(abi.encodeCall(Timba.completeGame, (game, SECRET)));
            assertEq(settled, v[5] == 1, rows[i]);
            if (settled) assertEq(token.balanceOf(operator) - beforeFee, v[9], rows[i]);
            vm.revertToState(beforeSettlement);
            if (v[1] > 0) {
                vm.prank(alice);
                (bool refunded,) = address(timba).call(abi.encodeCall(Timba.refundPlayer, (game, address(0x100))));
                assertEq(refunded, v[6] == 1, rows[i]);
            }
            vm.revertToState(snapshot);
        }
    }

    function testRefundEventDescribesSwapAndLastRemoval() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        r.maxPlayers = 3;
        bytes32 game = create(r, true);
        join(game, bob);
        vm.warp(timba.getGame(game).expiresAt + 1 hours);
        vm.expectEmit(true, true, false, true, address(timba));
        emit Timba.PlayerRefunded(game, alice, 100 ether, 0, bob);
        vm.prank(alice);
        timba.refundPlayer(game, alice);
        assertEq(timba.getGame(game).participants[0], bob);
        vm.expectEmit(true, true, false, true, address(timba));
        emit Timba.PlayerRefunded(game, bob, 100 ether, 0, address(0));
        vm.prank(bob);
        timba.refundPlayer(game, bob);
    }

    function testCoinflipSettlement() public {
        bytes32 game = create(request(Timba.GameType.Coinflip), true);
        join(game, bob);
        uint256 index = timba.winnerIndex(game, SECRET);
        address winner = index == 0 ? alice : bob;
        uint256 beforeBalance = token.balanceOf(winner);
        vm.prank(operator);
        timba.completeGame(game, SECRET);
        assertEq(token.balanceOf(winner) - beforeBalance, 198 ether);
        assertEq(token.balanceOf(operator), 2 ether);
        assertEq(timba.liabilities(address(token)), 0);
        assertEq(uint256(timba.getGame(game).status), uint256(Timba.Status.Completed));
        vm.prank(operator);
        vm.expectRevert(Timba.GameUnavailable.selector);
        timba.completeGame(game, SECRET);
    }

    function testGiveawayPaysPrizeAndCreatorCanRecoverUnderfilled() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Giveaway);
        bytes32 game = create(r, false);
        join(game, bob);
        assertEq(token.balanceOf(bob), 1_000_000 ether);
        vm.warp(timba.getGame(game).expiresAt);
        vm.prank(alice);
        timba.closeGame(game);
        assertEq(token.balanceOf(alice), 1_000_000 ether);
        assertEq(timba.liabilities(address(token)), 0);
        r = request(Timba.GameType.Giveaway);
        r.minPlayers = 1;
        r.maxPlayers = 1;
        game = create(r, false);
        join(game, bob);
        vm.prank(operator);
        timba.completeGame(game, SECRET);
        assertEq(token.balanceOf(bob), 1_000_099 ether);
    }

    function testRecoveryBoundaryAndSwapRemoval() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        r.maxPlayers = 3;
        bytes32 game = create(r, true);
        join(game, bob);
        uint256 expiry = timba.getGame(game).expiresAt;
        vm.warp(expiry + 1 hours - 1);
        vm.prank(alice);
        vm.expectRevert(Timba.RecoveryUnavailable.selector);
        timba.refundPlayer(game, alice);
        vm.warp(expiry + 1 hours);
        vm.prank(operator);
        vm.expectRevert(Timba.GameUnavailable.selector);
        timba.completeGame(game, SECRET);
        vm.prank(alice);
        timba.refundPlayer(game, alice);
        assertEq(timba.participantIndex(game, bob), 1);
        vm.prank(alice);
        timba.refundPlayer(game, bob);
        assertEq(token.balanceOf(bob), 1_000_000 ether);
        vm.prank(alice);
        timba.closeGame(game);
        assertEq(timba.liabilities(address(token)), 0);
    }

    function testUnderfilledRefundAtExpiryAndNoEarlyUnjoin() public {
        bytes32 game = create(request(Timba.GameType.Coinflip), true);
        vm.prank(alice);
        vm.expectRevert(Timba.RecoveryUnavailable.selector);
        timba.refundPlayer(game, alice);
        vm.warp(timba.getGame(game).expiresAt);
        vm.prank(alice);
        timba.refundPlayer(game, alice);
        assertEq(token.balanceOf(alice), 1_000_000 ether);
    }

    function testOperatorCleanupCannotTakeGiveawayFunds() public {
        bytes32 game = create(request(Timba.GameType.Giveaway), false);
        vm.prank(operator);
        vm.expectRevert(Timba.RecoveryUnavailable.selector);
        timba.closeGame(game);
        vm.warp(timba.getGame(game).expiresAt + 1 hours);
        vm.prank(operator);
        timba.closeGame(game);
        assertEq(token.balanceOf(alice), 1_000_000 ether);
        assertEq(token.balanceOf(operator), 0);
    }

    function testRejectDuplicateExpiredAndUnauthorizedActions() public {
        bytes32 game = create(request(Timba.GameType.Coinflip), true);
        vm.prank(alice);
        vm.expectRevert(Timba.EntryUnavailable.selector);
        timba.joinGame(game, 0, "");
        vm.prank(bob);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.refundPlayer(game, alice);
        vm.prank(alice);
        vm.expectRevert();
        timba.completeGame(game, SECRET);
        vm.prank(operator);
        vm.expectRevert(Timba.GameUnavailable.selector);
        timba.completeGame(game, SECRET);
        vm.warp(timba.getGame(game).expiresAt);
        vm.prank(bob);
        vm.expectRevert(Timba.EntryUnavailable.selector);
        timba.joinGame(game, 0, "");
    }

    function testSignatureReplayMutationExpiryAndNonceCancellation() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        bytes memory signature = sign(timba.creationDigest(r));
        r.amount++;
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        r.amount--;
        vm.prank(bob);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        vm.prank(alice);
        timba.createGame(r, signature, false);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        r = request(Timba.GameType.Coinflip);
        signature = sign(timba.creationDigest(r));
        vm.warp(r.deadline + 1);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        r = request(Timba.GameType.Coinflip);
        signature = sign(timba.creationDigest(r));
        vm.prank(alice);
        timba.invalidateCreationNonce(r.nonce + 1);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
    }

    function testCrossChainAndContractReplayRejected() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        bytes memory signature = sign(timba.creationDigest(r));
        uint256 chain = block.chainid;
        vm.chainId(chain + 1);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        vm.chainId(chain);
        Timba other = Timba(
            address(
                new ERC1967Proxy(
                    address(new Timba()), abi.encodeCall(Timba.initialize, (operator, address(0xad), defaults()))
                )
            )
        );
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        other.createGame(r, signature, false);
    }

    function testPrivateJoinAuthorizationAndRotation() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        r.isPrivate = true;
        bytes32 game = create(r, true);
        bytes memory signature = sign(timba.joinDigest(game, bob, block.timestamp + 10));
        vm.prank(bob);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.joinGame(game, block.timestamp + 11, signature);
        vm.prank(bob);
        timba.joinGame(game, block.timestamp + 10, signature);
        vm.prank(operator);
        timba.transferOwnership(bob);
        vm.prank(bob);
        timba.acceptOwnership();
        vm.prank(operator);
        vm.expectRevert();
        timba.completeGame(game, SECRET);
        vm.prank(bob);
        timba.completeGame(game, SECRET);
    }

    function testContractOperatorSignatures() public {
        OperatorWallet wallet = new OperatorWallet();
        vm.prank(operator);
        timba.transferOwnership(address(wallet));
        wallet.accept(timba);
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        wallet.approveDigest(timba.creationDigest(r));
        vm.prank(alice);
        timba.createGame(r, "", false);
    }

    function testLiveFeeAndBufferAndCeilings() public {
        bytes32 game = create(request(Timba.GameType.Coinflip), true);
        join(game, bob);
        Timba.OracleConfig memory next = defaults();
        next.feePercentage = 10;
        next.buffer = 1 days;
        vm.prank(operator);
        timba.configure(next);
        vm.prank(operator);
        timba.completeGame(game, SECRET);
        assertEq(token.balanceOf(operator), 20 ether);
        next.buffer++;
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidConfig.selector);
        timba.configure(next);
        next = defaults();
        next.maxTimeout++;
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidConfig.selector);
        timba.configure(next);
        next = defaults();
        next.maxPlayers++;
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidConfig.selector);
        timba.configure(next);
    }

    function testAnyContractTokenRequiresOperatorAuthorizationButNoAllowlist() public {
        Token other = new Token();
        fund(alice, other);
        Timba.CreateRequest memory r = request(Timba.GameType.Giveaway);
        r.token = address(other);
        bytes32 game = create(r, false);
        assertEq(timba.liabilities(address(other)), r.amount);
        vm.prank(alice);
        timba.closeGame(game);
        assertEq(timba.liabilities(address(other)), 0);
        r = request(Timba.GameType.Giveaway);
        bytes memory signature = sign(timba.creationDigest(r));
        r.token = address(other);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.createGame(r, signature, false);
        r.token = address(0);
        signature = sign(timba.creationDigest(r));
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidToken.selector);
        timba.createGame(r, signature, false);
    }

    function testWrongRevealAndCrossGameAccounting() public {
        bytes32 first = create(request(Timba.GameType.Coinflip), true);
        bytes32 second = create(request(Timba.GameType.Giveaway), false);
        join(first, bob);
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidReveal.selector);
        timba.completeGame(first, bytes32(uint256(1)));
        vm.prank(operator);
        timba.completeGame(first, SECRET);
        assertEq(timba.liabilities(address(token)), 100 ether);
        assertEq(token.balanceOf(address(timba)), 100 ether);
        vm.prank(alice);
        timba.closeGame(second);
        assertEq(token.balanceOf(address(timba)), 0);
    }

    function testTransferTaxRejectedAndStateRollsBack() public {
        TaxToken tax = new TaxToken();
        fund(alice, tax);
        Timba.CreateRequest memory r = request(Timba.GameType.Giveaway);
        r.token = address(tax);
        bytes memory signature = sign(timba.creationDigest(r));
        tax.setTax(true);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidTransfer.selector);
        timba.createGame(r, signature, false);
        assertEq(timba.creationNonces(alice), 0);
        tax.setTax(false);
        bytes32 game = create(r, false);
        tax.setTax(true);
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidTransfer.selector);
        timba.closeGame(game);
        assertEq(timba.getGame(game).totalAmount, 100 ether);
        assertEq(timba.liabilities(address(tax)), 100 ether);
    }

    function testReentrancyBlockedDuringDeposit() public {
        CallbackToken callback = new CallbackToken();
        fund(alice, callback);
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        r.token = address(callback);
        callback.arm(timba, timba.gameIdFor(alice, r.nonce));
        bytes32 game = create(r, true);
        assertTrue(callback.blocked());
        assertEq(timba.getGame(game).participants.length, 1);
    }

    function testFuzzAccounting(uint96 rawAmount, uint8 rawFee) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100_000 ether);
        uint8 fee = uint8(bound(uint256(rawFee), 0, 10));
        Timba.OracleConfig memory next = defaults();
        next.feePercentage = fee;
        vm.prank(operator);
        timba.configure(next);
        Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
        r.amount = amount;
        bytes32 game = create(r, true);
        join(game, bob);
        vm.prank(operator);
        timba.completeGame(game, SECRET);
        assertEq(token.balanceOf(address(timba)), 0);
        assertEq(timba.liabilities(address(token)), 0);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(operator), 2_000_000 ether);
    }

    function testConfigurationAuthorizationAndInvalidBoundaries() public {
        Timba.OracleConfig memory c = defaults();
        vm.prank(alice);
        vm.expectRevert();
        timba.configure(c);
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.renounceOwnership();
        vm.prank(operator);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.transferOwnership(address(timba));
        for (uint256 i; i < 5; i++) {
            c = defaults();
            if (i == 0) c.feePercentage = 11;
            if (i == 1) c.buffer = 0;
            if (i == 2) c.minTimeout = 0;
            if (i == 3) c.minTimeout = c.maxTimeout + 1;
            if (i == 4) c.maxPlayers = 0;
            vm.prank(operator);
            vm.expectRevert(Timba.InvalidConfig.selector);
            timba.configure(c);
        }
    }

    function testCreationLimitsAndAtomicDepositFailure() public {
        for (uint256 i; i < 7; i++) {
            Timba.CreateRequest memory r = request(Timba.GameType.Coinflip);
            if (i == 0) r.amount = 0;
            if (i == 1) r.minPlayers = 1;
            if (i == 2) r.maxPlayers = 1;
            if (i == 3) r.maxPlayers = 1001;
            if (i == 4) r.timeout = 30 days + 1;
            if (i == 5) r.timeout = 0;
            if (i == 6) r.amount = type(uint256).max;
            bytes memory signature = sign(timba.creationDigest(r));
            vm.prank(alice);
            vm.expectRevert(Timba.InvalidGame.selector);
            timba.createGame(r, signature, true);
        }
        vm.prank(alice);
        token.approve(address(timba), 0);
        Timba.CreateRequest memory valid = request(Timba.GameType.Coinflip);
        bytes memory sig = sign(timba.creationDigest(valid));
        vm.prank(alice);
        vm.expectRevert();
        timba.createGame(valid, sig, true);
        assertEq(timba.creationNonces(alice), 0);
        assertEq(uint256(timba.getGame(timba.gameIdFor(alice, 0)).status), uint256(Timba.Status.Missing));
    }

    function testReadyGiveawayCannotCloseEarlyAndRecoversAtLiveBoundary() public {
        bytes32 game = create(request(Timba.GameType.Giveaway), true);
        join(game, bob);
        uint256 expiry = timba.getGame(game).expiresAt;
        vm.prank(alice);
        vm.expectRevert(Timba.RecoveryUnavailable.selector);
        timba.closeGame(game);
        Timba.OracleConfig memory c = defaults();
        c.buffer = 1 days;
        vm.prank(operator);
        timba.configure(c);
        vm.warp(expiry + 1 hours);
        vm.prank(alice);
        vm.expectRevert(Timba.RecoveryUnavailable.selector);
        timba.closeGame(game);
        vm.warp(expiry + 1 days);
        vm.prank(alice);
        timba.closeGame(game);
        assertEq(token.balanceOf(alice), 1_000_000 ether);
    }

    function testInitializeRejectsInvalidAuthorities() public {
        Timba implementation = new Timba();
        for (uint256 i; i < 3; i++) {
            address proxy = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
            address initialOperator = i == 0 ? proxy : operator;
            address authority = i == 1 ? address(0) : i == 2 ? proxy : address(0xad);
            vm.expectRevert(Timba.InvalidAuthorization.selector);
            new ERC1967Proxy(
                address(implementation), abi.encodeCall(Timba.initialize, (initialOperator, authority, defaults()))
            );
        }
    }

    function testNonceInvalidationMustIncrease() public {
        vm.startPrank(alice);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.invalidateCreationNonce(0);
        timba.invalidateCreationNonce(5);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.invalidateCreationNonce(5);
        vm.stopPrank();
        assertEq(timba.creationNonces(alice), 5);
    }

    function testRejectZeroCommitmentAndSelfToken() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Giveaway);
        r.commitment = bytes32(0);
        bytes memory signature = sign(timba.creationDigest(r));
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidGame.selector);
        timba.createGame(r, signature, false);
        r = request(Timba.GameType.Giveaway);
        r.token = address(timba);
        signature = sign(timba.creationDigest(r));
        vm.prank(alice);
        vm.expectRevert(Timba.InvalidToken.selector);
        timba.createGame(r, signature, false);
    }

    function testRejectStrangerCloseAndNonParticipantRefund() public {
        bytes32 game = create(request(Timba.GameType.Giveaway), false);
        vm.prank(bob);
        vm.expectRevert(Timba.InvalidAuthorization.selector);
        timba.closeGame(game);
        vm.prank(operator);
        vm.expectRevert(Timba.GameUnavailable.selector);
        timba.winnerIndex(game, SECRET);
        vm.warp(timba.getGame(game).expiresAt);
        vm.prank(bob);
        vm.expectRevert(Timba.EntryUnavailable.selector);
        timba.refundPlayer(game, bob);
    }

    function testGasMaximumParticipants() public {
        Timba.CreateRequest memory r = request(Timba.GameType.Giveaway);
        r.maxPlayers = 1_000;
        bytes32 game = create(r, false);
        for (uint256 i; i < 1_000; i++) {
            join(game, address(uint160(i + 10_000)));
        }
        uint256 beforeGas = gasleft();
        vm.prank(operator);
        timba.completeGame(game, SECRET);
        emit log_named_uint("settlement gas at 1000 players", beforeGas - gasleft());
        assertEq(timba.liabilities(address(token)), 0);
    }
}
