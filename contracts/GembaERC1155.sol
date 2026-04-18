// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

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
 *         At deploy, creator chooses numberOfIds (1-1000) and maxSupplyPerToken.
 *         NO tokens are minted at deploy — owner mints on demand via mint()/mintBatch().
 *         IDs are 1 to numberOfIds. Max supply enforced per token ID.
 */
contract GembaERC1155 is ERC1155, ERC1155Supply, ERC2981, Ownable {
    string public name;
    string public symbol;
    uint256 public totalIds;
    uint256 public maxSupplyPerToken;
    string private _contractURI;
    string private _baseTokenURI;
    string private _uriSuffix = ".json";

    uint96 public immutable royaltyFee; // basis points, locked at deploy

    event ContractURIUpdated(string newContractURI);
    event URIUpdated(string newURI);
    event URISuffixUpdated(string newSuffix);
    event RoyaltyReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event CreatedViaGembaTools(address indexed token, string name, string symbol);

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
        maxSupplyPerToken = supplyPerToken_;
        _contractURI = contractURI_;
        _baseTokenURI = uri_;
        royaltyFee = royaltyFee_;

        _setDefaultRoyalty(royaltyReceiver_, royaltyFee_);
        
        emit CreatedViaGembaTools(address(this), name_, symbol_);
    }

    // ===================== Minting =====================

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        require(id >= 1 && id <= totalIds, "GembaERC1155: invalid ID");
        require(totalSupply(id) + amount <= maxSupplyPerToken, "GembaERC1155: exceeds max supply");
        _mint(to, id, amount, "");
    }

    function mintBatch(
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts
    ) external onlyOwner {
        for (uint256 i = 0; i < ids.length; i++) {
            require(ids[i] >= 1 && ids[i] <= totalIds, "GembaERC1155: invalid ID");
            require(totalSupply(ids[i]) + amounts[i] <= maxSupplyPerToken, "GembaERC1155: exceeds max supply");
        }
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

    /// @notice Returns per-token URI: baseURI + id + suffix
    function uri(uint256 id) public view override returns (string memory) {
        string memory base = _baseTokenURI;
        return bytes(base).length > 0
            ? string(abi.encodePacked(base, Strings.toString(id), _uriSuffix))
            : super.uri(id);
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function setURI(string calldata newURI) external onlyOwner {
        _baseTokenURI = newURI;
        _setURI(newURI);
        emit URIUpdated(newURI);
    }

    function setURISuffix(string calldata newSuffix) external onlyOwner {
        _uriSuffix = newSuffix;
        emit URISuffixUpdated(newSuffix);
    }

    // ===================== Royalties =====================

    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "GembaERC1155: zero receiver");
        (address oldReceiver, ) = royaltyInfo(0, 0);
        _setDefaultRoyalty(newReceiver, royaltyFee);
        emit RoyaltyReceiverUpdated(oldReceiver, newReceiver);
    }

    // ===================== Internal overrides =====================

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }

    // ===================== Interface support =====================

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
