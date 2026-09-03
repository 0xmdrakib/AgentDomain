// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title AgentIdentityRegistry
 * @author AgentDomain
 * @notice ERC-721 registry of AI agent identities. Each NFT bundles a traditional
 *         domain, a Basename, an optional ENS name, and metadata URI.
 * @dev Minting is gated to authorized minters (typically the PaymentRouter).
 *      The contract owner is a multisig; it can add/remove minters and revoke
 *      identities for ToS violations. Owners of an identity can update its
 *      metadata and transfer the NFT freely.
 *
 *      Multi-token ownership: a single wallet can own MANY agent identities.
 *      `getTokenIdsByOwner(owner)` returns all token IDs owned by a wallet.
 */
contract AgentIdentityRegistry is ERC721, Ownable {
    using Strings for uint256;

    struct Identity {
        address owner;
        string domain;
        string basename;
        string ensName;
        string metadataUri;
        uint64 createdAt;
        uint64 expiresAt;
        bool revoked;
    }

    /// @dev Next token ID to be minted (starts at 1 for human-friendliness).
    uint256 private _nextTokenId = 1;

    /// @dev tokenId => Identity record.
    mapping(uint256 => Identity) private _identities;

    /// @dev domain string => tokenId.
    mapping(string => uint256) private _domainToTokenId;

    /// @dev wallet => array of tokenIds owned. Maintained on transfer.
    /// Allows a single wallet to own multiple agent identities.
    mapping(address => uint256[]) private _ownerTokens;

    /// @dev tokenId => index in _ownerTokens[owner] (for O(1) removal).
    mapping(uint256 => uint256) private _ownerTokenIndex;

    /// @dev address => is authorized to mint?
    mapping(address => bool) public minters;

    /// @dev Address of the RenewalVault, allowed to extend expiry.
    address public renewalVault;

    error NotAuthorizedMinter();
    error NotRenewalVault();
    error DomainAlreadyRegistered(string domain);
    error TokenDoesNotExist(uint256 tokenId);
    error EmptyDomain();
    error NotTokenOwner();
    error AlreadyRevoked(uint256 tokenId);
    error InvalidExpiry();
    error ZeroAddress();

    event IdentityMinted(
        uint256 indexed tokenId,
        address indexed owner,
        string domain,
        string basename,
        string ensName,
        uint64 expiresAt
    );
    event IdentityMetadataUpdated(uint256 indexed tokenId, string newUri);
    event IdentityExpiryExtended(uint256 indexed tokenId, uint64 newExpiresAt);
    event IdentityRevoked(uint256 indexed tokenId, string reason);
    event MinterSet(address indexed minter, bool allowed);
    event RenewalVaultUpdated(address indexed previous, address indexed next);

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotAuthorizedMinter();
        _;
    }

    modifier onlyRenewalVault() {
        if (msg.sender != renewalVault) revert NotRenewalVault();
        _;
    }

    constructor(address initialOwner) ERC721("AgentDomain Identity", "AGENTID") Ownable(initialOwner) {}

    // -------------------------------------------------------------------
    //                        ADMIN
    // -------------------------------------------------------------------

    /**
     * @notice Authorize or revoke a minter (e.g. the PaymentRouter).
     */
    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    /**
     * @notice Set the renewal vault address.
     */
    function setRenewalVault(address vault) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        emit RenewalVaultUpdated(renewalVault, vault);
        renewalVault = vault;
    }

    // -------------------------------------------------------------------
    //                        MINTING
    // -------------------------------------------------------------------

    function mintIdentity(
        address to,
        string calldata domain,
        string calldata basename,
        string calldata ensName,
        string calldata metadataUri,
        uint64 expiresAt
    ) external onlyMinter returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(domain).length == 0) revert EmptyDomain();
        if (_domainToTokenId[domain] != 0) revert DomainAlreadyRegistered(domain);
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        tokenId = _nextTokenId++;
        _identities[tokenId] = Identity({
            owner: to,
            domain: domain,
            basename: basename,
            ensName: ensName,
            metadataUri: metadataUri,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });

        _domainToTokenId[domain] = tokenId;

        _safeMint(to, tokenId);
        // _safeMint triggers _update which adds tokenId to _ownerTokens[to]

        emit IdentityMinted(tokenId, to, domain, basename, ensName, expiresAt);
    }

    // -------------------------------------------------------------------
    //                        UPDATES
    // -------------------------------------------------------------------

    function updateMetadata(uint256 tokenId, string calldata newUri) external {
        _requireExists(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _identities[tokenId].metadataUri = newUri;
        emit IdentityMetadataUpdated(tokenId, newUri);
    }

    function extendExpiry(uint256 tokenId, uint64 newExpiresAt) external onlyRenewalVault {
        _requireExists(tokenId);
        Identity storage id = _identities[tokenId];
        if (newExpiresAt <= id.expiresAt) revert InvalidExpiry();
        id.expiresAt = newExpiresAt;
        emit IdentityExpiryExtended(tokenId, newExpiresAt);
    }

    function revokeIdentity(uint256 tokenId, string calldata reason) external onlyOwner {
        _requireExists(tokenId);
        Identity storage id = _identities[tokenId];
        if (id.revoked) revert AlreadyRevoked(tokenId);
        id.revoked = true;
        emit IdentityRevoked(tokenId, reason);
    }

    // -------------------------------------------------------------------
    //                        VIEWS
    // -------------------------------------------------------------------

    function getIdentity(uint256 tokenId) external view returns (Identity memory) {
        _requireExists(tokenId);
        return _identities[tokenId];
    }

    /**
     * @notice Returns all token IDs owned by a given wallet.
     * @dev O(1) lookup. Order is mint order, except for transfers which use swap-and-pop.
     */
    function getTokenIdsByOwner(address owner_) external view returns (uint256[] memory) {
        return _ownerTokens[owner_];
    }

    /**
     * @notice Returns the most recently acquired token ID for a wallet,
     *         or 0 if none owned.
     * @dev Kept for backward-compatibility. Use getTokenIdsByOwner for full list.
     */
    function getTokenIdByOwner(address owner_) external view returns (uint256) {
        uint256[] storage list = _ownerTokens[owner_];
        if (list.length == 0) return 0;
        return list[list.length - 1];
    }

    function balanceOfDomains(address owner_) external view returns (uint256) {
        return _ownerTokens[owner_].length;
    }

    function getTokenIdByDomain(string calldata domain) external view returns (uint256) {
        return _domainToTokenId[domain];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireExists(tokenId);
        return _identities[tokenId].metadataUri;
    }

    /**
     * @notice True if the identity has expired AND has not been renewed.
     *         A revoked identity is also considered "not active" but isExpired returns
     *         based purely on time; check isRevoked separately.
     */
    function isExpired(uint256 tokenId) external view returns (bool) {
        _requireExists(tokenId);
        return block.timestamp >= _identities[tokenId].expiresAt;
    }

    function isRevoked(uint256 tokenId) external view returns (bool) {
        _requireExists(tokenId);
        return _identities[tokenId].revoked;
    }

    /**
     * @notice True only if the identity is fully active (not expired, not revoked).
     */
    function isActive(uint256 tokenId) external view returns (bool) {
        _requireExists(tokenId);
        Identity storage id = _identities[tokenId];
        return !id.revoked && block.timestamp < id.expiresAt;
    }

    // -------------------------------------------------------------------
    //                        INTERNAL
    // -------------------------------------------------------------------

    function _requireExists(uint256 tokenId) internal view {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);
    }

    /**
     * @dev Maintain _ownerTokens[] on every mint/transfer/burn so that
     *      multi-token ownership stays consistent.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        // Remove tokenId from sender's list (skip on mint where from == address(0))
        if (from != address(0)) {
            _removeTokenFromOwner(from, tokenId);
        }

        // Add to recipient (skip on burn where to == address(0))
        if (to != address(0)) {
            _addTokenToOwner(to, tokenId);
            _identities[tokenId].owner = to;
        }

        return from;
    }

    function _addTokenToOwner(address owner_, uint256 tokenId) internal {
        _ownerTokenIndex[tokenId] = _ownerTokens[owner_].length;
        _ownerTokens[owner_].push(tokenId);
    }

    function _removeTokenFromOwner(address owner_, uint256 tokenId) internal {
        uint256[] storage list = _ownerTokens[owner_];
        uint256 idx = _ownerTokenIndex[tokenId];
        uint256 lastIdx = list.length - 1;

        if (idx != lastIdx) {
            uint256 lastTokenId = list[lastIdx];
            list[idx] = lastTokenId;
            _ownerTokenIndex[lastTokenId] = idx;
        }

        list.pop();
        delete _ownerTokenIndex[tokenId];
    }
}
