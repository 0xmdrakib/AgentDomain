// SPDX-License-Identifier: Apache-2.0
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
 *      can withdraw available funds. A keeper bot first reserves one token's
 *      quoted renewal cost, then completes the charge only after the external
 *      registrar renewal succeeds. Reserved funds cannot be withdrawn or used
 *      for any other token.
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

    struct RenewalReservation {
        uint256 amount;
        uint64 expiresAt;
        uint64 reservedAt;
    }

    /// @notice tokenId => renewal amount locked by a keeper while registrar renewal is in flight.
    mapping(uint256 => RenewalReservation) public pendingRenewals;

    /// @notice tokenId => last renewal timestamp.
    mapping(uint256 => uint64) public lastRenewedAt;

    /// @notice Whether auto-renewal is enabled for a token.
    mapping(uint256 => bool) public autoRenewEnabled;

    /// @notice Number of seconds added per renewal cycle (1 year default).
    uint64 public renewalDuration = 365 days;

    /// @notice Maximum time before expiry that a renewal can be triggered (30 days).
    uint64 public renewalWindow = 30 days;

    /// @notice Minimum accepted renewal quote (atomic, 6 decimals). Zero means unset.
    uint256 public renewalFee;

    uint64 private constant MAX_RENEWAL_EXPIRY_DRIFT = 31 days;

    event Deposited(uint256 indexed tokenId, address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawn(uint256 indexed tokenId, address indexed to, uint256 amount, uint256 newBalance);
    event RenewalReserved(uint256 indexed tokenId, uint256 amount, uint64 expiresAt);
    event RenewalCanceled(uint256 indexed tokenId, uint256 amount);
    event RenewalCompleted(uint256 indexed tokenId, uint256 cost, uint64 newExpiresAt);
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
    error RenewalAlreadyPending(uint256 tokenId);
    error NoPendingRenewal(uint256 tokenId);
    error RenewalCostTooLow(uint256 quotedCost, uint256 minimumCost);
    error InvalidRenewalExpiry(uint64 previousExpiresAt, uint64 newExpiresAt);
    error UseTwoStepRenewal();
    error UseRegistrarConfirmedExpiry();

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
     * @notice Withdraw available USDC from a token's vault. Only NFT owner can withdraw.
     * @dev Pending renewal reservations are removed from `balanceOfToken`, so a
     *      direct contract withdrawal cannot take funds that a keeper already locked.
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
     * @notice Lock the exact quoted renewal amount for a token. Only authorized keepers.
     * @dev This does not transfer USDC to treasury and does not extend expiry. The
     *      off-chain keeper must renew the registrar domain, then call completeRenewalWithExpiry.
     *      If the registrar renewal fails before completion, the keeper calls cancelRenewal.
     * @param tokenId The agent identity NFT to renew.
     * @param quotedCost Exact USDC amount quoted off-chain for this token's renewal.
     */
    function reserveRenewal(uint256 tokenId, uint256 quotedCost)
        external
        nonReentrant
        onlyKeeper
        returns (uint256 cost, uint64 expiresAt)
    {
        return _reserveRenewal(tokenId, quotedCost);
    }

    /**
     * @notice Legacy completion path is disabled so expiry dates match the registrar.
     */
    function completeRenewal(uint256) external pure {
        revert UseRegistrarConfirmedExpiry();
    }

    /**
     * @notice Complete a reserved renewal using the registrar-confirmed expiry.
     * @dev The keeper calls this only after Spaceship confirms the domain expiry advanced.
     */
    function completeRenewalWithExpiry(uint256 tokenId, uint64 newExpiresAt) external nonReentrant onlyKeeper {
        _completeRenewal(tokenId, newExpiresAt);
    }

    /**
     * @notice Release a reservation when registrar renewal failed before completion.
     */
    function cancelRenewal(uint256 tokenId) external nonReentrant onlyKeeper {
        RenewalReservation memory pending = pendingRenewals[tokenId];
        if (pending.amount == 0) revert NoPendingRenewal(tokenId);
        delete pendingRenewals[tokenId];
        balanceOfToken[tokenId] += pending.amount;
        emit RenewalCanceled(tokenId, pending.amount);
    }

    /**
     * @notice Legacy single-transaction renewal path is disabled for production safety.
     */
    function executeRenewal(uint256) external pure {
        revert UseTwoStepRenewal();
    }

    function _reserveRenewal(uint256 tokenId, uint256 quotedCost)
        internal
        returns (uint256 cost, uint64 expiresAt)
    {
        uint256 minimumCost = renewalFee;
        if (minimumCost == 0) revert ZeroAmount();
        if (quotedCost < minimumCost) revert RenewalCostTooLow(quotedCost, minimumCost);
        if (pendingRenewals[tokenId].amount != 0) revert RenewalAlreadyPending(tokenId);
        if (!autoRenewEnabled[tokenId]) revert AutoRenewDisabled();

        AgentIdentityRegistry.Identity memory id = registry.getIdentity(tokenId);
        if (id.revoked) revert IdentityRevoked(tokenId);
        if (id.expiresAt > block.timestamp + renewalWindow) revert TooEarly();
        if (block.timestamp > id.expiresAt + renewalWindow) revert ExpiredTooLong();
        if (balanceOfToken[tokenId] < quotedCost) revert InsufficientBalance();

        balanceOfToken[tokenId] -= quotedCost;
        pendingRenewals[tokenId] = RenewalReservation({
            amount: quotedCost,
            expiresAt: id.expiresAt,
            reservedAt: uint64(block.timestamp)
        });
        emit RenewalReserved(tokenId, quotedCost, id.expiresAt);
        return (quotedCost, id.expiresAt);
    }

    function _completeRenewal(uint256 tokenId, uint64 newExpiresAt) internal {
        RenewalReservation memory pending = pendingRenewals[tokenId];
        if (pending.amount == 0) revert NoPendingRenewal(tokenId);

        AgentIdentityRegistry.Identity memory id = registry.getIdentity(tokenId);
        if (id.revoked) revert IdentityRevoked(tokenId);
        if (block.timestamp > pending.expiresAt + renewalWindow) revert ExpiredTooLong();

        uint64 currentTime = uint64(block.timestamp);
        uint64 maxBase = pending.expiresAt > currentTime ? pending.expiresAt : currentTime;
        if (
            newExpiresAt <= pending.expiresAt
                || newExpiresAt <= currentTime
                || newExpiresAt > maxBase + renewalDuration + MAX_RENEWAL_EXPIRY_DRIFT
        ) {
            revert InvalidRenewalExpiry(pending.expiresAt, newExpiresAt);
        }

        delete pendingRenewals[tokenId];
        uint256 cost = pending.amount;
        usdc.safeTransfer(treasury, cost);

        registry.extendExpiry(tokenId, newExpiresAt);
        lastRenewedAt[tokenId] = uint64(block.timestamp);

        emit RenewalCompleted(tokenId, cost, newExpiresAt);
        emit RenewalExecuted(tokenId, cost, newExpiresAt);
    }

    // -------------------------------------------------------------------
    //                        VIEWS
    // -------------------------------------------------------------------

    function isRenewable(uint256 tokenId) external view returns (bool) {
        if (!autoRenewEnabled[tokenId]) return false;
        if (pendingRenewals[tokenId].amount != 0) return false;
        AgentIdentityRegistry.Identity memory id = registry.getIdentity(tokenId);
        if (id.revoked) return false;
        return id.expiresAt <= block.timestamp + renewalWindow &&
               block.timestamp <= id.expiresAt + renewalWindow;
    }

    function pendingRenewalAmount(uint256 tokenId) external view returns (uint256) {
        return pendingRenewals[tokenId].amount;
    }

    function _requireTokenExists(uint256 tokenId) internal view {
        try nft.ownerOf(tokenId) returns (address owner) {
            if (owner == address(0)) revert TokenDoesNotExist(tokenId);
        } catch {
            revert TokenDoesNotExist(tokenId);
        }
    }
}
