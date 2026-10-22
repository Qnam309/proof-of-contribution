// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ContributionRegistry
 * @notice MVP registry for verifiable contribution hashes on an EVM chain.
 * @dev Review is permissioned on-chain; quality of evidence is evaluated off-chain.
 *      The admin can appoint/revoke reviewers. Metadata URI is public and immutable.
 */
contract ContributionRegistry {
    enum Status { None, Pending, Approved, Rejected }

    struct Contribution {
        address contributor;
        bytes32 contentHash;
        string evidenceURI;
        uint64 submittedAt;
        uint64 reviewedAt;
        address reviewer;
        Status status;
    }

    address public immutable admin;
    uint256 public nextId = 1;
    mapping(address => bool) public reviewers;
    mapping(uint256 => Contribution) private contributions;
    mapping(address => mapping(bytes32 => bool)) public submittedHashes;

    event ReviewerUpdated(address indexed reviewer, bool authorized);
    event ContributionSubmitted(uint256 indexed id, address indexed contributor, bytes32 indexed contentHash, string evidenceURI);
    event ContributionReviewed(uint256 indexed id, address indexed reviewer, Status decision);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyReviewer() {
        require(reviewers[msg.sender], "Not an authorized reviewer");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function setReviewer(address reviewer, bool authorized) external onlyAdmin {
        require(reviewer != address(0), "Invalid reviewer");
        reviewers[reviewer] = authorized;
        emit ReviewerUpdated(reviewer, authorized);
    }

    /** @notice evidenceURI should point to public metadata/evidence, not secret data. */
    function submitContribution(bytes32 contentHash, string calldata evidenceURI) external returns (uint256 id) {
        require(contentHash != bytes32(0), "Empty hash");
        require(bytes(evidenceURI).length > 0 && bytes(evidenceURI).length <= 512, "Invalid evidence URI");
        require(!submittedHashes[msg.sender][contentHash], "Duplicate hash");

        id = nextId++;
        contributions[id] = Contribution({
            contributor: msg.sender,
            contentHash: contentHash,
            evidenceURI: evidenceURI,
            submittedAt: uint64(block.timestamp),
            reviewedAt: 0,
            reviewer: address(0),
            status: Status.Pending
        });
        submittedHashes[msg.sender][contentHash] = true;
        emit ContributionSubmitted(id, msg.sender, contentHash, evidenceURI);
    }

    function approveContribution(uint256 id) external onlyReviewer {
        _review(id, Status.Approved);
    }

    function rejectContribution(uint256 id) external onlyReviewer {
        _review(id, Status.Rejected);
    }

    function _review(uint256 id, Status decision) private {
        Contribution storage item = contributions[id];
        require(item.status != Status.None, "Contribution not found");
        require(item.status == Status.Pending, "Already reviewed");
        require(msg.sender != item.contributor, "Self review forbidden");
        item.status = decision;
        item.reviewer = msg.sender;
        item.reviewedAt = uint64(block.timestamp);
        emit ContributionReviewed(id, msg.sender, decision);
    }

    function getContribution(uint256 id) external view returns (Contribution memory) {
        require(contributions[id].status != Status.None, "Contribution not found");
        return contributions[id];
    }

    function verifyContribution(uint256 id, bytes32 expectedHash) external view returns (bool) {
        Contribution storage item = contributions[id];
        return item.status == Status.Approved && item.contentHash == expectedHash;
    }
}
