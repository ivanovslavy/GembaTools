// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GembaERC721
 * @notice ERC721 NFT collection with full marketplace integration.
 *
 *         Royalties (ERC2981):
 *           - royaltyFee is immutable (set at deploy, basis points, max 10%)
 *           - royaltyReceiver is changeable by owner
 *           - OpenSea, LooksRare, Blur, Rarible all read ERC2981
 *
 *         Metadata:
 *           - name() and symbol() show in browser tabs and explorer pages
 *           - tokenURI() = baseURI + tokenId for per-token metadata
 *           - contractURI() for collection-level metadata (OpenSea reads this)
 *
 *         Minting:
 *           - Owner can mint() single or mintBatch() multiple NFTs
 *           - maxSupply enforced (0 = unlimited)
 */
contract GembaERC721 is ERC721, ERC2981, Ownable {
    uint256 private _nextTokenId;
    uint256 public maxSupply;
    string private _baseTokenURI;
    string private _contractURI;

    uint96 public immutable royaltyFee; // basis points, locked at deploy

    event BaseURIUpdated(string newBaseURI);
    event ContractURIUpdated(string newContractURI);
    event RoyaltyReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    /**
     * @param name_            Collection name (Etherscan, MetaMask, browser tab)
     * @param symbol_          Collection symbol
     * @param maxSupply_       Maximum NFTs (0 = unlimited)
     * @param baseURI_         Base URI for token metadata
     * @param contractURI_     Collection metadata URI (OpenSea reads this)
     * @param owner_           Collection owner (can mint, update URIs)
     * @param royaltyReceiver_ Address that receives royalties (changeable)
     * @param royaltyFee_      Royalty in basis points (e.g. 500 = 5%), immutable, max 1000 (10%)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        string memory baseURI_,
        string memory contractURI_,
        address owner_,
        address royaltyReceiver_,
        uint96 royaltyFee_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        require(bytes(name_).length > 0, "GembaERC721: empty name");
        require(bytes(symbol_).length > 0, "GembaERC721: empty symbol");
        require(owner_ != address(0), "GembaERC721: zero owner");
        require(royaltyReceiver_ != address(0), "GembaERC721: zero royalty receiver");
        require(royaltyFee_ <= 1000, "GembaERC721: royalty exceeds 10%");

        maxSupply = maxSupply_;
        _baseTokenURI = baseURI_;
        _contractURI = contractURI_;
        royaltyFee = royaltyFee_;

        // Set default royalty for all tokens
        _setDefaultRoyalty(royaltyReceiver_, royaltyFee_);
    }

    // ===================== Minting =====================

    function mint(address to) external onlyOwner returns (uint256) {
        require(maxSupply == 0 || _nextTokenId < maxSupply, "GembaERC721: max supply reached");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    function mintBatch(address to, uint256 amount) external onlyOwner {
        require(maxSupply == 0 || _nextTokenId + amount <= maxSupply, "GembaERC721: exceeds max supply");
        for (uint256 i = 0; i < amount; i++) {
            _safeMint(to, _nextTokenId++);
        }
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice Burn an NFT. Caller must own it or be approved.
    function burn(uint256 tokenId) external {
        require(
            ownerOf(tokenId) == msg.sender ||
            getApproved(tokenId) == msg.sender ||
            isApprovedForAll(ownerOf(tokenId), msg.sender),
            "GembaERC721: not owner or approved"
        );
        _burn(tokenId);
    }

    // ===================== Metadata =====================

    /// @notice Collection-level metadata (OpenSea reads this)
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ===================== Royalties =====================

    /// @notice Update royalty receiver. Fee stays the same (immutable).
    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "GembaERC721: zero receiver");
        (address oldReceiver, ) = royaltyInfo(0, 0);
        _setDefaultRoyalty(newReceiver, royaltyFee);
        emit RoyaltyReceiverUpdated(oldReceiver, newReceiver);
    }

    // ===================== Interface support =====================

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
