// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GembaERC1155.sol";

/**
 * @title GembaERC1155Factory
 * @notice Standalone factory for deploying ERC1155 multi-token collections.
 *         Creator chooses number of token IDs (1, 2, 5, 10, 100...) and
 *         supply per token at deployment. All minted to creator.
 *         Fee forwarded immediately to feeRecipient.
 *         Does NOT accept direct ETH transfers.
 */
contract GembaERC1155Factory is Ownable, ReentrancyGuard {

    address public feeRecipient;
    uint256 public creationFee;

    uint256 public constant MAX_IDS = 1000; // safety cap

    struct CollectionInfo {
        address collectionAddress;
        address creator;
        string name;
        string symbol;
        uint256 numberOfIds;
        uint256 supplyPerToken;
        uint256 createdAt;
    }

    CollectionInfo[] public allCollections;
    mapping(address => CollectionInfo[]) public collectionsByCreator;

    event CollectionCreated(
        address indexed collectionAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 numberOfIds,
        uint256 supplyPerToken,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(
        address owner_,
        address feeRecipient_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(feeRecipient_ != address(0), "ERC1155Factory: zero fee recipient");
        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    /**
     * @notice Deploy an ERC1155 multi-token collection.
     * @param name_           Collection name (shows on Etherscan/browser tab)
     * @param symbol_         Collection symbol
     * @param uri_            Metadata URI with {id} placeholder
     * @param numberOfIds_    How many token IDs (1, 2, 5, 10, 100)
     * @param supplyPerToken_ Supply minted per token ID
     * @return collection     Address of deployed collection
     */
    struct CreateParams {
        string name;
        string symbol;
        string uri;
        string contractURI;
        uint256 numberOfIds;
        uint256 supplyPerToken;
        address royaltyReceiver;
        uint96 royaltyFee;
    }

    function createToken(CreateParams calldata p)
        external payable nonReentrant returns (address collection)
    {
        require(msg.value >= creationFee, "ERC1155Factory: insufficient fee");
        require(p.numberOfIds > 0 && p.numberOfIds <= MAX_IDS, "ERC1155Factory: invalid ID count");
        require(p.supplyPerToken > 0, "ERC1155Factory: zero supply");
        require(p.royaltyFee <= 1000, "ERC1155Factory: royalty exceeds 10%");

        GembaERC1155 newCollection = new GembaERC1155(
            p.name,
            p.symbol,
            p.uri,
            p.contractURI,
            p.numberOfIds,
            p.supplyPerToken,
            msg.sender,
            p.royaltyReceiver == address(0) ? msg.sender : p.royaltyReceiver,
            p.royaltyFee
        );

        collection = address(newCollection);

        allCollections.push(CollectionInfo({
            collectionAddress: collection,
            creator: msg.sender,
            name: p.name,
            symbol: p.symbol,
            numberOfIds: p.numberOfIds,
            supplyPerToken: p.supplyPerToken,
            createdAt: block.timestamp
        }));
        collectionsByCreator[msg.sender].push(allCollections[allCollections.length - 1]);

        emit CollectionCreated(
            collection, msg.sender, p.name, p.symbol,
            p.numberOfIds, p.supplyPerToken, block.timestamp
        );

        (bool sent, ) = payable(feeRecipient).call{value: creationFee}("");
        require(sent, "ERC1155Factory: fee transfer failed");

        uint256 excess = msg.value - creationFee;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            require(refunded, "ERC1155Factory: refund failed");
        }

        return collection;
    }

    function totalCollections() external view returns (uint256) { return allCollections.length; }
    function getCollectionsByCreator(address c) external view returns (CollectionInfo[] memory) { return collectionsByCreator[c]; }

    function setFeeRecipient(address r) external onlyOwner {
        require(r != address(0), "ERC1155Factory: zero address");
        emit FeeRecipientUpdated(feeRecipient, r);
        feeRecipient = r;
    }

    function setCreationFee(uint256 f) external onlyOwner {
        emit CreationFeeUpdated(creationFee, f);
        creationFee = f;
    }
}
