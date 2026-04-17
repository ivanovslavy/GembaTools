// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GembaERC1155
 * @notice Multi-token (ERC1155) with full marketplace integration.
 *
 *         Royalties (ERC2981):
 *           - royaltyFee is immutable (basis points, max 10%)
 *           - royaltyReceiver is changeable by owner
 *
 *         Metadata:
 *           - name() and symbol() for Etherscan/browser tab display
 *           - uri() with {id} placeholder for per-token metadata
 *           - contractURI() for collection-level metadata (OpenSea)
 *
 *         At deploy, creator chooses numberOfIds (1-1000) and supplyPerToken.
 *         All tokens minted to owner. IDs start from 1.
 */
contract GembaERC1155 is ERC1155, ERC2981, Ownable {
    string public name;
    string public symbol;
    uint256 public totalIds;
    string private _contractURI;

    uint96 public immutable royaltyFee; // basis points, locked at deploy

    event ContractURIUpdated(string newContractURI);
    event URIUpdated(string newURI);
    event RoyaltyReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);

    /**
     * @param name_             Collection name (Etherscan/browser tab)
     * @param symbol_           Collection symbol
     * @param uri_              Token metadata URI with {id} placeholder
     * @param contractURI_      Collection metadata URI (OpenSea reads this)
     * @param numberOfIds_      How many token IDs to create (1-1000)
     * @param supplyPerToken_   Supply minted per token ID
     * @param owner_            Collection owner
     * @param royaltyReceiver_  Address that receives royalties (changeable)
     * @param royaltyFee_       Royalty in basis points (max 1000 = 10%), immutable
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        string memory contractURI_,
        uint256 numberOfIds_,
        uint256 supplyPerToken_,
        address owner_,
        address royaltyReceiver_,
        uint96 royaltyFee_
    ) ERC1155(uri_) Ownable(owner_) {
        require(bytes(name_).length > 0, "GembaERC1155: empty name");
        require(bytes(symbol_).length > 0, "GembaERC1155: empty symbol");
        require(numberOfIds_ > 0, "GembaERC1155: zero IDs");
        require(supplyPerToken_ > 0, "GembaERC1155: zero supply");
        require(owner_ != address(0), "GembaERC1155: zero owner");
        require(royaltyReceiver_ != address(0), "GembaERC1155: zero royalty receiver");
        require(royaltyFee_ <= 1000, "GembaERC1155: royalty exceeds 10%");

        name = name_;
        symbol = symbol_;
        totalIds = numberOfIds_;
        _contractURI = contractURI_;
        royaltyFee = royaltyFee_;

        _setDefaultRoyalty(royaltyReceiver_, royaltyFee_);

        // Batch mint all IDs to owner
        uint256[] memory ids = new uint256[](numberOfIds_);
        uint256[] memory amounts = new uint256[](numberOfIds_);
        for (uint256 i = 0; i < numberOfIds_; i++) {
            ids[i] = i + 1;
            amounts[i] = supplyPerToken_;
        }
        _mintBatch(owner_, ids, amounts, "");
    }

    // ===================== Minting =====================

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        _mint(to, id, amount, "");
    }

    function mintBatch(
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts
    ) external onlyOwner {
        _mintBatch(to, ids, amounts, "");
    }

    // ===================== Burning =====================

    /// @notice Burn your own tokens
    function burn(uint256 id, uint256 amount) external {
        _burn(msg.sender, id, amount);
    }

    /// @notice Burn multiple IDs at once
    function burnBatch(uint256[] calldata ids, uint256[] calldata amounts) external {
        _burnBatch(msg.sender, ids, amounts);
    }

    // ===================== Metadata =====================

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function setURI(string calldata newURI) external onlyOwner {
        _setURI(newURI);
        emit URIUpdated(newURI);
    }

    // ===================== Royalties =====================

    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "GembaERC1155: zero receiver");
        (address oldReceiver, ) = royaltyInfo(0, 0);
        _setDefaultRoyalty(newReceiver, royaltyFee);
        emit RoyaltyReceiverUpdated(oldReceiver, newReceiver);
    }

    // ===================== Interface support =====================

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
