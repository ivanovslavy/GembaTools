// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GembaERC721.sol";

/**
 * @title GembaERC721Factory
 * @notice Standalone factory for deploying ERC721 NFT collections.
 *         Each createToken() deploys a real GembaERC721 contract.
 *         Fee forwarded immediately to feeRecipient.
 *         Does NOT accept direct ETH transfers.
 */
contract GembaERC721Factory is Ownable, ReentrancyGuard {

    address public feeRecipient;
    uint256 public creationFee;

    struct CollectionInfo {
        address collectionAddress;
        address creator;
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 createdAt;
    }

    CollectionInfo[] public allCollections;
    mapping(address => CollectionInfo[]) public collectionsByCreator;

    event CollectionCreated(
        address indexed collectionAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(
        address owner_,
        address feeRecipient_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(feeRecipient_ != address(0), "ERC721Factory: zero fee recipient");
        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    /**
     * @notice Deploy an ERC721 NFT collection with ERC2981 royalties.
     * @param name_            Collection name
     * @param symbol_          Collection symbol
     * @param maxSupply_       Max NFTs (0 = unlimited)
     * @param baseURI_         Base metadata URI
     * @param contractURI_     Collection metadata URI (OpenSea)
     * @param royaltyReceiver_ Address that receives royalties
     * @param royaltyFee_      Royalty in basis points (max 1000 = 10%), immutable
     * @return collection      Address of deployed collection
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint256 maxSupply_,
        string calldata baseURI_,
        string calldata contractURI_,
        address royaltyReceiver_,
        uint96 royaltyFee_
    ) external payable nonReentrant returns (address collection) {
        require(msg.value >= creationFee, "ERC721Factory: insufficient fee");
        require(royaltyFee_ <= 1000, "ERC721Factory: royalty exceeds 10%");

        GembaERC721 newCollection = new GembaERC721(
            name_,
            symbol_,
            maxSupply_,
            baseURI_,
            contractURI_,
            msg.sender,
            royaltyReceiver_ == address(0) ? msg.sender : royaltyReceiver_,
            royaltyFee_
        );

        collection = address(newCollection);

        allCollections.push(CollectionInfo({
            collectionAddress: collection,
            creator: msg.sender,
            name: name_,
            symbol: symbol_,
            maxSupply: maxSupply_,
            createdAt: block.timestamp
        }));
        collectionsByCreator[msg.sender].push(allCollections[allCollections.length - 1]);

        emit CollectionCreated(collection, msg.sender, name_, symbol_, maxSupply_, block.timestamp);

        (bool sent, ) = payable(feeRecipient).call{value: creationFee}("");
        require(sent, "ERC721Factory: fee transfer failed");

        uint256 excess = msg.value - creationFee;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            require(refunded, "ERC721Factory: refund failed");
        }

        return collection;
    }

    function totalCollections() external view returns (uint256) { return allCollections.length; }
    function getCollectionsByCreator(address c) external view returns (CollectionInfo[] memory) { return collectionsByCreator[c]; }

    function setFeeRecipient(address r) external onlyOwner {
        require(r != address(0), "ERC721Factory: zero address");
        emit FeeRecipientUpdated(feeRecipient, r);
        feeRecipient = r;
    }

    function setCreationFee(uint256 f) external onlyOwner {
        emit CreationFeeUpdated(creationFee, f);
        creationFee = f;
    }
}
