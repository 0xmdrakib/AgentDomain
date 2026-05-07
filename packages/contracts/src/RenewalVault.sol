// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AgentIdentityRegistry} from "./AgentIdentityRegistry.sol";

/**
 * @title RenewalVault
 * @author AgentDomain
 * @notice Holds USDC on behalf of agent identities for autonomous renewals.
 * @dev Each tokenId has its own balance. Anyone can deposit. Only the NFT owner
 *      can withdraw. A keeper bot triggers renewals when within the renewal window.
 *      The keeper must be authorized; the renewal cost is sent to the treasury,
 *      and the registry's expiry is extended.
 */
contract RenewalVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The USDC token used for renewals.
    IERC20 public immutable usdc;

    /// @notice The identity registry whose expiries are extended.
    AgentIdentityRegistry public immutable registry;

    /// @notice The ERC-721 contract (same as registry, but typed).
    IERC721 public immutable nft;

    /// @notice Treasury that receives renewal fees.
    address public treasury;

    /// @notice Authorized keeper bot that can trigger renewals.
    mapping(address => bool) public keepers;

    /// @notice tokenId => USDC balance (atomic, 6 decimals).
    mapping(uint256 => uint256) public balanceOfToken;

    /// @notice tokenId => last renewal timestamp.
    mapping(uint256 => uint64) public lastRenewedAt;

    /// @notice Whether auto-renewal is enabled for a token.
    mapping(uint256 => bool) public autoRenewEnabled;

    /// @notice Number of seconds added per renewal cycle (1 year default).
    uint64 public renewalDuration = 365 days;

    /// @notice Maximum time before expiry that a renewal can be triggered (30 days).
    uint64 public renewalWindow = 30 days;

    /// @notice Fixed USDC renewal fee charged per cycle (atomic, 6 decimals). Zero means unset.
    uint256 public renewalFee;

    event Deposited(uint256 indexed tokenId, address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawn(uint256 indexed tokenId, address indexed to, uint256 amount, uint256 newBalance);
    event RenewalExecuted(uint256 indexed tokenId, uint256 cost, uint64 newExpiresAt);
    event AutoRenewToggled(uint256 indexed tokenId, bool enabled);
    event KeeperSet(address indexed keeper, bool allowed);
    event TreasuryUpdated(address indexed previous, address indexed next);
    event RenewalParamsUpdated(uint64 duration, uint64 window);

    error NotTokenOwner();
    error NotKeeper();
    error InsufficientBalance();
    error AutoRenewDisabled();
    error TooEarly();
    error ExpiredTooLong();
    error ZeroAddress();
    error ZeroAmount();
    error TokenDoesNotExist(uint256 tokenId);
    error InvalidRenewalParams();
    error IdentityRevoked(uint256 tokenId);

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert NotKeeper();
        _;
    }

    constructor(
        address initialOwner,
        IERC20 usdc_,
        AgentIdentityRegistry registry_,
        address nft_,
        address treasury_
    ) Ownable(initialOwner) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (nft_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();

        usdc = usdc_;
        registry = registry_;
        nft = IERC721(nft_);
        treasury = treasury_;
    }

    // -------------------------------------------------------------------
    //                        ADMIN
    // -------------------------------------------------------------------

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setRenewalParams(uint64 duration, uint64 window, uint256 fee) external onlyOwner {
        if (duration == 0 || window == 0 || window > duration) revert InvalidRenewalParams();
        if (fee == 0) revert ZeroAmount();
        renewalDuration = duration;
        renewalWindow = window;
        renewalFee = fee;
        emit RenewalParamsUpdated(duration, window);
    }

    // -------------------------------------------------------------------
    //                        DEPOSIT / WITHDRAW
    // -------------------------------------------------------------------

    /**
     * @notice Deposit USDC into a token's renewal vault. Anyone can deposit.
     */
    function deposit(uint256 tokenId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _requireTokenExists(tokenId);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balanceOfToken[tokenId] += amount;
        emit Deposited(tokenId, msg.sender, amount, balanceOfToken[tokenId]);
    }

    /**
     * @notice Withdraw USDC from a token's vault. Only NFT owner can withdraw.
     */
    function withdraw(uint256 tokenId, uint256 amount) external nonReentrant {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (amount == 0) revert ZeroAmount();
        if (balanceOfToken[tokenId] < amount) revert InsufficientBalance();

        balanceOfToken[tokenId] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(tokenId, msg.sender, amount, balanceOfToken[tokenId]);
    }

    /**
     * @notice Toggle auto-renewal for a token. Only NFT owner.
     */
    function setAutoRenew(uint256 tokenId, bool enabled) external {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        autoRenewEnabled[tokenId] = enabled;
        emit AutoRenewToggled(tokenId, enabled);
    }

    // -------------------------------------------------------------------
    //                        RENEWAL EXECUTION
    // -------------------------------------------------------------------

    /**
     * @notice Trigger a renewal for a token. Only authorized keepers.
     * @dev Charges the fixed `renewalFee` from the vault and extends expiry
     *      by `renewalDuration`. Both "too early" and "too late" are blocked.
     * @param tokenId The agent identity NFT to renew.
     */
    function executeRenewal(uint256 tokenId) external nonReentrant onlyKeeper {
        uint256 cost = renewalFee;
        if (cost == 0) revert ZeroAmount();
        if (!autoRenewEnabled[tokenId]) revert AutoRenewDisabled();
        if (balanceOfToken[tokenId] < cost) revert InsufficientBalance();

        AgentIdentityRegistry.Identity memory id = registry.getIdentity(tokenId);
        if (id.revoked) revert IdentityRevoked(tokenId);
        if (id.expiresAt > block.timestamp + renewalWindow) revert TooEarly();
        if (block.timestamp > id.expiresAt + renewalWindow) revert ExpiredTooLong();

        balanceOfToken[tokenId] -= cost;
        usdc.safeTransfer(treasury, cost);

        // Extend from NOW, not from the stale expiresAt.
        // This prevents paying for renewal on an already-expired identity
        // without actually making it active.
        uint64 base = uint64(block.timestamp);
        if (id.expiresAt > base) base = id.expiresAt;
        uint64 newExpiresAt = base + renewalDuration;
        registry.extendExpiry(tokenId, newExpiresAt);
        lastRenewedAt[tokenId] = uint64(block.timestamp);

        emit RenewalExecuted(tokenId, cost, newExpiresAt);
    }

    // -------------------------------------------------------------------
    //                        VIEWS
    // -------------------------------------------------------------------

    function isRenewable(uint256 tokenId) external view returns (bool) {
        if (!autoRenewEnabled[tokenId]) return false;
        AgentIdentityRegistry.Identity memory id = registry.getIdentity(tokenId);
        if (id.revoked) return false;
        return id.expiresAt <= block.timestamp + renewalWindow &&
               block.timestamp <= id.expiresAt + renewalWindow;
    }

    function _requireTokenExists(uint256 tokenId) internal view {
        try nft.ownerOf(tokenId) returns (address owner) {
            if (owner == address(0)) revert TokenDoesNotExist(tokenId);
        } catch {
            revert TokenDoesNotExist(tokenId);
        }
    }
}
