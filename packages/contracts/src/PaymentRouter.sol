// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AgentIdentityRegistry} from "./AgentIdentityRegistry.sol";

/**
 * @title PaymentRouter
 * @author AgentDomain
 * @notice Receives USDC payments for agent identity registrations and triggers minting.
 * @dev Designed to support TWO payment flows:
 *
 *      Flow A: x402 (PRIMARY)
 *        - Agent signs EIP-3009 transferWithAuthorization off-chain.
 *        - Backend settles the auth to the configured payment recipient, then
 *          off-chain code may sweep the treasury allocation.
 *        - Backend calls `mintForPaidRegistration()` here, which only mints (no pull).
 *        - This is how 99% of registrations should flow.
 *
 *      Flow B: ERC-20 approval (FALLBACK)
 *        - Agent calls USDC.approve(this, amount) first.
 *        - Backend calls `processRegistration()` which pulls USDC then mints.
 *        - Used for agents that don't support EIP-3009.
 *
 *      Flow C: Permit (FALLBACK 2)
 *        - Agent signs EIP-2612 permit().
 *        - Backend calls `processRegistrationWithPermit()` which calls permit()
 *          then transferFrom() then mint.
 *
 *      All three flows go through the same idempotency-key gate to prevent
 *      double-processing the same payment intent.
 */
contract PaymentRouter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct RegistrationIntent {
        address payer;
        address recipient;
        string domain;
        string basename;
        string ensName;
        string metadataUri;
        uint256 amount;
        uint64 duration;
        bytes32 idempotencyKey;
    }

    /// @notice The USDC contract used for payments.
    IERC20 public immutable usdc;

    /// @notice The identity registry that mints NFTs.
    AgentIdentityRegistry public immutable registry;

    /// @notice Treasury address that receives collected fees.
    address public treasury;

    /// @notice Authorized backend signer; only this address can call processRegistration.
    address public authorizedBackend;

    /// @notice Used idempotency keys (prevents double processing).
    mapping(bytes32 => bool) public usedKeys;

    /// @notice Total USDC ever processed (for stats).
    uint256 public totalProcessed;

    /// @notice Minimum registration duration accepted (seconds).
    uint64 public constant MIN_DURATION = 365 days;

    /// @notice Maximum registration duration accepted (10 years - sanity bound).
    uint64 public constant MAX_DURATION = 10 * 365 days;

    event RegistrationProcessed(
        bytes32 indexed idempotencyKey,
        uint256 indexed tokenId,
        address indexed payer,
        address recipient,
        string domain,
        uint256 amount
    );
    event TreasuryUpdated(address indexed previous, address indexed next);
    event BackendUpdated(address indexed previous, address indexed next);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error UnauthorizedBackend();
    error IdempotencyKeyUsed(bytes32 key);
    error InvalidAmount();
    error InvalidDuration();
    error TransferFailed();
    error ZeroAddress();
    error PermitFailed();
    error ZeroIdempotencyKey();

    modifier onlyBackend() {
        if (msg.sender != authorizedBackend) revert UnauthorizedBackend();
        _;
    }

    constructor(
        address initialOwner,
        IERC20 usdc_,
        AgentIdentityRegistry registry_,
        address treasury_,
        address authorizedBackend_
    ) Ownable(initialOwner) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (authorizedBackend_ == address(0)) revert ZeroAddress();

        usdc = usdc_;
        registry = registry_;
        treasury = treasury_;
        authorizedBackend = authorizedBackend_;
    }

    // -------------------------------------------------------------------
    //                        ADMIN
    // -------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setAuthorizedBackend(address newBackend) external onlyOwner {
        if (newBackend == address(0)) revert ZeroAddress();
        emit BackendUpdated(authorizedBackend, newBackend);
        authorizedBackend = newBackend;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------------
    //                        FLOW A: x402 (PRIMARY)
    // -------------------------------------------------------------------

    /**
     * @notice Mint an identity NFT for a payment that has already been
     *         settled off-chain (e.g. via x402 transferWithAuthorization).
     * @dev USDC has ALREADY settled before this call. We only verify the
     *      backend signed off and mint. The amount field is recorded for
     *      accounting but not pulled here.
     */
    function mintForPaidRegistration(RegistrationIntent calldata intent)
        external
        nonReentrant
        whenNotPaused
        onlyBackend
        returns (uint256 tokenId)
    {
        _validateIntent(intent);
        usedKeys[intent.idempotencyKey] = true;
        totalProcessed += intent.amount;

        tokenId = _mintIdentity(intent);

        emit RegistrationProcessed(
            intent.idempotencyKey, tokenId, intent.payer, intent.recipient, intent.domain, intent.amount
        );
    }

    // -------------------------------------------------------------------
    //                        FLOW B: PRE-APPROVED PULL
    // -------------------------------------------------------------------

    /**
     * @notice Process a paid registration. Pulls USDC from the payer (must have
     *         pre-approved this contract via USDC.approve()), then mints the NFT.
     */
    function processRegistration(RegistrationIntent calldata intent)
        external
        nonReentrant
        whenNotPaused
        onlyBackend
        returns (uint256 tokenId)
    {
        _validateIntent(intent);
        usedKeys[intent.idempotencyKey] = true;

        // Pull USDC from payer to treasury.
        usdc.safeTransferFrom(intent.payer, treasury, intent.amount);
        totalProcessed += intent.amount;

        tokenId = _mintIdentity(intent);

        emit RegistrationProcessed(
            intent.idempotencyKey, tokenId, intent.payer, intent.recipient, intent.domain, intent.amount
        );
    }

    // -------------------------------------------------------------------
    //                        FLOW C: PERMIT
    // -------------------------------------------------------------------

    /**
     * @notice Variant that uses EIP-2612 permit() so the agent doesn't need a
     *         separate approve transaction.
     * @dev USDC on Base supports EIP-2612 permit.
     */
    function processRegistrationWithPermit(
        RegistrationIntent calldata intent,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused onlyBackend returns (uint256 tokenId) {
        _validateIntent(intent);

        (bool ok,) = address(usdc).call(
            abi.encodeWithSignature(
                "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
                intent.payer,
                address(this),
                intent.amount,
                permitDeadline,
                v,
                r,
                s
            )
        );
        if (!ok) revert PermitFailed();

        usedKeys[intent.idempotencyKey] = true;
        usdc.safeTransferFrom(intent.payer, treasury, intent.amount);
        totalProcessed += intent.amount;

        tokenId = _mintIdentity(intent);

        emit RegistrationProcessed(
            intent.idempotencyKey, tokenId, intent.payer, intent.recipient, intent.domain, intent.amount
        );
    }

    // -------------------------------------------------------------------
    //                        EMERGENCY
    // -------------------------------------------------------------------

    /**
     * @notice Rescue any tokens accidentally sent to this contract.
     */
    function rescueToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // -------------------------------------------------------------------
    //                        INTERNAL
    // -------------------------------------------------------------------

    function _validateIntent(RegistrationIntent calldata intent) internal view {
        if (intent.payer == address(0)) revert ZeroAddress();
        if (intent.recipient == address(0)) revert ZeroAddress();
        if (intent.idempotencyKey == bytes32(0)) revert ZeroIdempotencyKey();
        if (intent.amount == 0) revert InvalidAmount();
        if (intent.duration < MIN_DURATION || intent.duration > MAX_DURATION) revert InvalidDuration();
        if (usedKeys[intent.idempotencyKey]) revert IdempotencyKeyUsed(intent.idempotencyKey);
    }

    function _mintIdentity(RegistrationIntent calldata intent) internal returns (uint256 tokenId) {
        uint64 expiresAt = uint64(block.timestamp) + intent.duration;
        tokenId = registry.mintIdentity(
            intent.recipient, intent.domain, intent.basename, intent.ensName, intent.metadataUri, expiresAt
        );
    }
}
