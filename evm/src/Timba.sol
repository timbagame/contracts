// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.30;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice ERC-20 coinflips and giveaways with a trusted commit-reveal operator.
/// @dev UUPS proxy implementation. The owner is the Oracle operator; upgrades use a separate authority.
contract Timba is Ownable2StepUpgradeable, EIP712Upgradeable, UUPSUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint32 public constant MAX_PLAYERS = 1_000;
    uint32 public constant MAX_TIMEOUT = 30 days;
    uint32 public constant MAX_BUFFER = 1 days;
    uint8 public constant MAX_FEE = 10;
    bytes32 public constant CREATE_TYPEHASH = keccak256(
        "CreateGame(address creator,address token,uint8 gameType,uint256 amount,uint32 minPlayers,uint32 maxPlayers,uint32 timeout,bool isPrivate,bytes32 commitment,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant JOIN_TYPEHASH = keccak256("JoinGame(bytes32 gameId,address player,uint256 deadline)");

    enum GameType {
        Coinflip,
        Giveaway
    }
    enum Status {
        Missing,
        Open,
        Completed,
        Closed
    }

    struct OracleConfig {
        uint8 feePercentage;
        uint32 buffer;
        uint32 minTimeout;
        uint32 maxTimeout;
        uint32 maxPlayers;
    }

    struct CreateRequest {
        address creator;
        address token;
        GameType gameType;
        uint256 amount;
        uint32 minPlayers;
        uint32 maxPlayers;
        uint32 timeout;
        bool isPrivate;
        bytes32 commitment;
        uint256 nonce;
        uint256 deadline;
    }

    struct Game {
        address creator;
        address token;
        GameType gameType;
        Status status;
        bool isPrivate;
        uint32 minPlayers;
        uint32 maxPlayers;
        uint64 expiresAt;
        uint256 ticketAmount;
        uint256 totalAmount;
        bytes32 commitment;
        uint256 lastEntryBlock;
        address[] participants;
    }

    // Preserve this storage layout and the Game/OracleConfig layouts in future upgrades.
    OracleConfig public config;
    mapping(address creator => uint256 nonce) public creationNonces;
    mapping(address token => uint256 amount) public liabilities;
    mapping(bytes32 gameId => Game game) private games;
    mapping(bytes32 gameId => mapping(address player => uint256 indexPlusOne)) public participantIndex;

    address public upgradeAuthority;
    address public pendingUpgradeAuthority;

    error InvalidConfig();
    error InvalidGame();
    error InvalidAuthorization();
    error InvalidToken();
    error InvalidTransfer();
    error GameUnavailable();
    error EntryUnavailable();
    error RecoveryUnavailable();
    error InvalidReveal();
    error RandomnessUnavailable();

    event OracleConfigured(OracleConfig config);
    event UpgradeAuthorityProposed(address indexed current, address indexed proposed);
    event UpgradeAuthorityTransferred(address indexed previous, address indexed current);
    event NonceInvalidated(address indexed creator, uint256 nonce);
    event GameCreated(bytes32 indexed gameId, address indexed creator, CreateRequest request, uint64 expiresAt);
    event PlayerJoined(bytes32 indexed gameId, address indexed player, uint256 index, uint256 entryBlock);
    event PlayerRefunded(
        bytes32 indexed gameId, address indexed player, uint256 amount, uint256 removedIndex, address movedParticipant
    );
    event GameCompleted(bytes32 indexed gameId, address indexed winner, uint256 prize, uint256 fee, bytes32 secret);
    event GameClosed(bytes32 indexed gameId, address indexed creator, uint256 refund);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address operator, address authority, OracleConfig calldata initialConfig) external initializer {
        if (operator == address(this) || authority == address(0) || authority == address(this)) {
            revert InvalidAuthorization();
        }
        __Ownable_init(operator);
        __Ownable2Step_init();
        __EIP712_init("Timba", "1");
        upgradeAuthority = authority;
        emit UpgradeAuthorityTransferred(address(0), authority);
        _configure(initialConfig);
    }

    function proposeUpgradeAuthority(address next) external {
        if (msg.sender != upgradeAuthority || next == address(0) || next == address(this)) {
            revert InvalidAuthorization();
        }
        pendingUpgradeAuthority = next;
        emit UpgradeAuthorityProposed(msg.sender, next);
    }

    function acceptUpgradeAuthority() external {
        if (msg.sender != pendingUpgradeAuthority) revert InvalidAuthorization();
        address previous = upgradeAuthority;
        upgradeAuthority = msg.sender;
        pendingUpgradeAuthority = address(0);
        emit UpgradeAuthorityTransferred(previous, msg.sender);
    }

    function upgradeToAndCall(address implementation, bytes memory data) public payable override nonReentrant {
        super.upgradeToAndCall(implementation, data);
    }

    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != upgradeAuthority) revert InvalidAuthorization();
    }

    function configure(OracleConfig calldata next) external nonReentrant onlyOwner {
        _configure(next);
    }

    function _configure(OracleConfig memory next) private {
        if (
            next.feePercentage > MAX_FEE || next.buffer == 0 || next.buffer > MAX_BUFFER || next.minTimeout == 0
                || next.maxTimeout < next.minTimeout || next.maxTimeout > MAX_TIMEOUT || next.maxPlayers == 0
                || next.maxPlayers > MAX_PLAYERS
        ) revert InvalidConfig();
        config = next;
        emit OracleConfigured(next);
    }

    /// @dev Removing the operator would prevent settlement. Rotation uses transferOwnership/acceptOwnership.
    function renounceOwnership() public view override onlyOwner {
        revert InvalidAuthorization();
    }

    function transferOwnership(address next) public override onlyOwner {
        if (next == address(this)) revert InvalidAuthorization();
        super.transferOwnership(next);
    }

    function invalidateCreationNonce(uint256 next) external {
        if (next <= creationNonces[msg.sender]) revert InvalidAuthorization();
        creationNonces[msg.sender] = next;
        emit NonceInvalidated(msg.sender, next);
    }

    function creationDigest(CreateRequest calldata request) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CREATE_TYPEHASH, request)));
    }

    function joinDigest(bytes32 gameId, address player, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(JOIN_TYPEHASH, gameId, player, deadline)));
    }

    function gameIdFor(address creator, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, nonce));
    }

    /// @param joinCreator Allows coinflip creation and the creator's first ticket to be atomic.
    function createGame(CreateRequest calldata request, bytes calldata signature, bool joinCreator)
        external
        nonReentrant
        returns (bytes32 gameId)
    {
        if (
            msg.sender != request.creator || request.nonce != creationNonces[msg.sender]
                || block.timestamp > request.deadline
                || !SignatureChecker.isValidSignatureNow(owner(), creationDigest(request), signature)
        ) {
            revert InvalidAuthorization();
        }
        if (request.token.code.length == 0 || request.token == address(this)) revert InvalidToken();
        OracleConfig memory limits = config;
        uint256 minimum = request.gameType == GameType.Coinflip ? 2 : 1;
        if (
            request.amount == 0 || request.commitment == bytes32(0) || request.minPlayers < minimum
                || request.maxPlayers < request.minPlayers || request.maxPlayers > limits.maxPlayers
                || request.timeout < limits.minTimeout || request.timeout > limits.maxTimeout
                || block.timestamp > type(uint64).max - request.timeout - MAX_BUFFER
        ) revert InvalidGame();
        if (request.gameType == GameType.Coinflip && request.amount > type(uint256).max / request.maxPlayers) {
            revert InvalidGame();
        }
        creationNonces[msg.sender]++;
        gameId = gameIdFor(msg.sender, request.nonce);
        Game storage game = games[gameId];
        game.creator = request.creator;
        game.token = request.token;
        game.gameType = request.gameType;
        game.status = Status.Open;
        game.isPrivate = request.isPrivate;
        game.minPlayers = request.minPlayers;
        game.maxPlayers = request.maxPlayers;
        game.expiresAt = uint64(block.timestamp + request.timeout);
        game.commitment = request.commitment;
        if (request.gameType == GameType.Coinflip) {
            game.ticketAmount = request.amount;
        } else {
            game.totalAmount = request.amount;
            _deposit(game.token, msg.sender, request.amount);
        }
        emit GameCreated(gameId, msg.sender, request, game.expiresAt);
        // The signed creation approves its creator, including in private games.
        if (joinCreator) _join(gameId, game, msg.sender);
    }

    function joinGame(bytes32 gameId, uint256 deadline, bytes calldata signature) external nonReentrant {
        Game storage game = _openGame(gameId);
        if (
            game.isPrivate
                && (block.timestamp > deadline
                    || !SignatureChecker.isValidSignatureNow(
                        owner(), joinDigest(gameId, msg.sender, deadline), signature
                    ))
        ) {
            revert InvalidAuthorization();
        }
        _join(gameId, game, msg.sender);
    }

    function _join(bytes32 gameId, Game storage game, address player) private {
        if (
            block.timestamp >= game.expiresAt || game.participants.length >= game.maxPlayers
                || participantIndex[gameId][player] != 0
        ) revert EntryUnavailable();
        game.participants.push(player);
        participantIndex[gameId][player] = game.participants.length;
        game.lastEntryBlock = block.number;
        game.totalAmount += game.ticketAmount;
        if (game.ticketAmount != 0) _deposit(game.token, player, game.ticketAmount);
        emit PlayerJoined(gameId, player, game.participants.length - 1, game.lastEntryBlock);
    }

    function completeGame(bytes32 gameId, bytes32 secret) external nonReentrant onlyOwner {
        Game storage game = _openGame(gameId);
        if (!_ready(game) || block.timestamp >= uint256(game.expiresAt) + config.buffer) revert GameUnavailable();
        address winner = game.participants[_winner(gameId, game, secret)];
        uint256 total = game.totalAmount;
        uint256 fee = Math.mulDiv(total, config.feePercentage, 100);
        game.totalAmount = 0;
        game.status = Status.Completed;
        _pay(game.token, winner, total - fee);
        _pay(game.token, owner(), fee);
        emit GameCompleted(gameId, winner, total - fee, fee, secret);
    }

    function winnerIndex(bytes32 gameId, bytes32 secret) external view returns (uint256) {
        Game storage game = games[gameId];
        return _winner(gameId, game, secret);
    }

    function _winner(bytes32 gameId, Game storage game, bytes32 secret) private view returns (uint256) {
        if (sha256(abi.encodePacked(secret)) != game.commitment) revert InvalidReveal();
        uint256 n = game.participants.length;
        if (n == 0) revert GameUnavailable();
        // Block number is a public, influenceable input, NOT an independent source of randomness.
        bytes32 entropy = keccak256(abi.encode(block.chainid, address(this), gameId, secret, game.lastEntryBlock));
        uint256 threshold;
        unchecked {
            threshold = (0 - n) % n;
        }
        for (uint256 i; i < 32; i++) {
            uint256 sample = uint256(entropy);
            if (sample >= threshold) return sample % n;
            entropy = keccak256(abi.encode(entropy, i));
        }
        revert RandomnessUnavailable();
    }

    function refundPlayer(bytes32 gameId, address player) external nonReentrant {
        Game storage game = _openGame(gameId);
        if (msg.sender != player && msg.sender != game.creator) revert InvalidAuthorization();
        if (!_canRecover(game)) revert RecoveryUnavailable();
        uint256 index = participantIndex[gameId][player];
        if (index == 0) revert EntryUnavailable();
        uint256 last = game.participants.length - 1;
        address moved;
        if (index - 1 != last) {
            moved = game.participants[last];
            game.participants[index - 1] = moved;
            participantIndex[gameId][moved] = index;
        }
        game.participants.pop();
        delete participantIndex[gameId][player];
        game.lastEntryBlock = block.number;
        game.totalAmount -= game.ticketAmount;
        _pay(game.token, player, game.ticketAmount);
        emit PlayerRefunded(gameId, player, game.ticketAmount, index - 1, moved);
    }

    function closeGame(bytes32 gameId) external nonReentrant {
        Game storage game = _openGame(gameId);
        bool empty = game.participants.length == 0;
        if (msg.sender != game.creator) {
            if (msg.sender != owner()) revert InvalidAuthorization();
            if (!empty || block.timestamp < uint256(game.expiresAt) + config.buffer) revert RecoveryUnavailable();
        } else if (!empty && (game.gameType == GameType.Coinflip || !_canRecover(game))) {
            revert RecoveryUnavailable();
        }
        uint256 refund = game.totalAmount;
        game.totalAmount = 0;
        game.status = Status.Closed;
        _pay(game.token, game.creator, refund);
        emit GameClosed(gameId, game.creator, refund);
    }

    function getGame(bytes32 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    function _openGame(bytes32 gameId) private view returns (Game storage game) {
        game = games[gameId];
        if (game.status != Status.Open) revert GameUnavailable();
    }

    function _ready(Game storage game) private view returns (bool) {
        uint256 count = game.participants.length;
        return count == game.maxPlayers || (count >= game.minPlayers && block.timestamp >= game.expiresAt);
    }

    function _canRecover(Game storage game) private view returns (bool) {
        return block.timestamp >= game.expiresAt
            && (!_ready(game) || block.timestamp >= uint256(game.expiresAt) + config.buffer);
    }

    function _deposit(address token, address from, uint256 amount) private {
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(from, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert InvalidTransfer();
        liabilities[token] += amount;
    }

    function _pay(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        uint256 recipientBalance = asset.balanceOf(to);
        liabilities[token] -= amount;
        asset.safeTransfer(to, amount);
        if (
            asset.balanceOf(address(this)) + amount != beforeBalance || asset.balanceOf(to) != recipientBalance + amount
        ) revert InvalidTransfer();
    }
}
