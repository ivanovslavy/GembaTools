// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "erc721a/contracts/ERC721A.sol";
import "erc721a/contracts/extensions/ERC721ABurnable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

    contract GembatoolsAdvancedNFT is ERC721A, ERC721ABurnable, ERC2981, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    
    mapping(bytes32 => bool) public usedSignatures;
    mapping(bytes32 => bool) public usedOrders;
        
    // Constants
    uint256 public constant MAX_BATCH_SIZE = 1000;
    uint256 public constant MAX_BATCH_TRANSFER = 100;
    uint256 public constant MAX_BATCH_BURN = 100;
    
    // Immutable state variables
    uint256 public immutable maxSupply;
    uint96 private immutable _royaltyBasisPoints;
    
    // State variables
    string private _baseTokenURI;
    string private _contractMetadataURI;

    // Events
    event TokenMinted(address indexed to, uint256 indexed tokenId);
    event BatchMinted(address indexed to, uint256 startTokenId, uint256 quantity);
    event TokenBurned(address indexed from, uint256 indexed tokenId);
    event RoyaltyReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event BatchTransferByID(address indexed from, address indexed to, uint256[] tokenIds);
    event BatchTransferByNumber(address indexed from, address indexed to, uint256 startId, uint256 count);
    event BatchBurned(address indexed burner, uint256[] tokenIds, uint256 count);
    event CreatedViaGembaTools(address indexed collection, string name, string symbol);
    
    // Custom errors
    error NoNativeTokensAccepted();
    error NoERC20TokensAccepted();
    error NoERC721TokensAccepted();
    error NoERC1155TokensAccepted();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        uint96 royaltyBasisPoints_,
        address royaltyReceiver_,
        address owner_
    ) ERC721A(name_, symbol_) Ownable(owner_) {
        require(bytes(baseURI_).length > 0, "Base URI cannot be empty");
        require(maxSupply_ > 0, "Max supply must be greater than 0");
        require(royaltyBasisPoints_ <= 1000, "Royalty cannot exceed 10%");
        require(royaltyReceiver_ != address(0), "Invalid royalty receiver");

        _baseTokenURI = baseURI_;
        maxSupply = maxSupply_;
        _royaltyBasisPoints = royaltyBasisPoints_;
        
        _setDefaultRoyalty(royaltyReceiver_, royaltyBasisPoints_);
        emit CreatedViaGembaTools(address(this), name_, symbol_);
    }

    // ========== MINTING FUNCTIONS ==========

    function mint(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Cannot mint to zero address");
        require(_totalMinted() < maxSupply, "Max supply reached");

        uint256 tokenId = _nextTokenId();
        _safeMint(to, 1);
        
        emit TokenMinted(to, tokenId);
    }

    function mintWithSignature(
        address to,
        bytes32 orderId,
        uint256 nonce,
        bytes memory signature
        ) external nonReentrant {
        
        // Create message hash
        bytes32 messageHash = keccak256(abi.encodePacked(to, orderId, nonce));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        // Verify signature
        address signer = ethSignedMessageHash.recover(signature);
        require(signer == owner(), "Invalid signature");
        require(!usedSignatures[ethSignedMessageHash], "Signature already used");
        
        // Mark as used
        usedSignatures[ethSignedMessageHash] = true;
        usedOrders[orderId] = true;
        
        // Mint
        require(to != address(0), "Cannot mint to zero address");
        require(_totalMinted() < maxSupply, "Max supply reached");
        
        uint256 tokenId = _nextTokenId();
        _safeMint(to, 1);
        
        emit TokenMinted(to, tokenId);
     }
    
    function batchMint(address to, uint256 quantity) external onlyOwner nonReentrant {
        require(to != address(0), "Cannot mint to zero address");
        require(quantity > 0, "Quantity must be greater than 0");
        require(quantity <= MAX_BATCH_SIZE, "Exceeds max batch size");
        require(_totalMinted() + quantity <= maxSupply, "Would exceed max supply");

        uint256 startTokenId = _nextTokenId();
        _safeMint(to, quantity);

        emit BatchMinted(to, startTokenId, quantity);
    }

    // ========== BATCH TRANSFER FUNCTIONS (PUBLIC) ==========

    /**
     * @dev Batch transfer specific token IDs to recipient (PUBLIC)
     * @param to Recipient address
     * @param tokenIds Array of specific token IDs to transfer
     */
    function batchTransferByID(address to, uint256[] calldata tokenIds) 
        external 
        nonReentrant 
    {
        require(to != address(0), "Invalid recipient");
        require(tokenIds.length > 0, "Empty array");
        require(tokenIds.length <= MAX_BATCH_TRANSFER, "Exceeds max batch transfer size");
        
        // Front-running protection: validate all tokens owned by caller first
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(_exists(tokenIds[i]), "Token does not exist");
            address tokenOwner = ownerOf(tokenIds[i]);
            require(
                tokenOwner == msg.sender || 
                getApproved(tokenIds[i]) == msg.sender ||
                isApprovedForAll(tokenOwner, msg.sender),
                "Not owner or approved"
            );
        }
        
        // Execute transfers after validation
        for (uint256 i = 0; i < tokenIds.length; i++) {
            address from = ownerOf(tokenIds[i]);
            safeTransferFrom(from, to, tokenIds[i]);
        }
        
        emit BatchTransferByID(msg.sender, to, tokenIds);
    }

    /**
     * @dev Batch transfer sequential tokens starting from specific ID (PUBLIC)
     * @param to Recipient address
     * @param startId Starting token ID number
     * @param count Number of sequential tokens to transfer
     */
    function batchTransferByNumber(address to, uint256 startId, uint256 count) 
        external 
        nonReentrant 
    {
        require(to != address(0), "Invalid recipient");
        require(count > 0, "Count must be greater than 0");
        require(count <= MAX_BATCH_TRANSFER, "Exceeds max batch transfer size");
        
        // Front-running protection: validate all tokens first
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = startId + i;
            require(_exists(tokenId), "Token does not exist");
            address tokenOwner = ownerOf(tokenId);
            require(
                tokenOwner == msg.sender || 
                getApproved(tokenId) == msg.sender ||
                isApprovedForAll(tokenOwner, msg.sender),
                "Not owner or approved"
            );
        }
        
        // Execute transfers after validation
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = startId + i;
            address from = ownerOf(tokenId);
            safeTransferFrom(from, to, tokenId);
        }
        
        emit BatchTransferByNumber(msg.sender, to, startId, count);
    }

    // ========== BATCH BURN FUNCTION (PUBLIC) ==========

    /**
     * @dev Public batch burn - burn multiple NFTs at once
     * @param tokenIds Array of token IDs to burn
     */
    function batchBurn(uint256[] calldata tokenIds) 
        external 
        nonReentrant 
    {
        require(tokenIds.length > 0, "Empty array");
        require(tokenIds.length <= MAX_BATCH_BURN, "Exceeds max batch burn size");
        
        // Front-running protection: validate ownership first
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(_exists(tokenIds[i]), "Token does not exist");
            address tokenOwner = ownerOf(tokenIds[i]);
            require(
                tokenOwner == msg.sender || 
                getApproved(tokenIds[i]) == msg.sender ||
                isApprovedForAll(tokenOwner, msg.sender),
                "Not owner or approved"
            );
        }
        
        // Execute burns after validation
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _burn(tokenIds[i]);
        }
        
        emit BatchBurned(msg.sender, tokenIds, tokenIds.length);
    }

    // ========== BURNING FUNCTION (Original) ==========

    function burn(uint256 tokenId) public override {
        super.burn(tokenId);
        emit TokenBurned(msg.sender, tokenId);
    }

    // ========== ROYALTY MANAGEMENT ==========

    function setRoyaltyReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "Invalid royalty receiver");
        
        address oldReceiver = _getDefaultRoyaltyReceiverAddress();
        _setDefaultRoyalty(newReceiver, _royaltyBasisPoints);
        
        emit RoyaltyReceiverUpdated(oldReceiver, newReceiver);
    }

    function setContractURI(string memory contractURI_) external onlyOwner {
        _contractMetadataURI = contractURI_;
    }

    function contractURI() public view returns (string memory) {
        return _contractMetadataURI;
    }

    function getRoyaltyBasisPoints() public view returns (uint96) {
        return _royaltyBasisPoints;
    }

    // ========== URI FUNCTIONS ==========

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override(ERC721A, IERC721A) returns (string memory) {
    if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
    
    string memory baseURI = _baseURI();
    return string(abi.encodePacked(baseURI, _toString(tokenId), ".json"));
    }

    // ========== SUPPLY TRACKING ==========

    function totalSupply() public view override(ERC721A, IERC721A) returns (uint256) {
        return super.totalSupply();
    }

    function totalMinted() public view returns (uint256) {
        return _totalMinted();
    }

    function totalBurned() public view returns (uint256) {
        return _totalBurned();
    }

    function remainingSupply() public view returns (uint256) {
        return maxSupply - _totalMinted();
    }

    function _startTokenId() internal pure override returns (uint256) {
        return 0;
    }

    function _getDefaultRoyaltyReceiverAddress() internal view returns (address) {
        (address receiver, ) = royaltyInfo(0, 10000);
        return receiver;
    }

    // ========== INTERFACE SUPPORT ==========

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721A, ERC2981, IERC721A)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ========== BLOCK ALL TOKEN RECEIPTS ==========

    /**
     * @dev Block receiving native ETH
     */
    receive() external payable {
        revert NoNativeTokensAccepted();
    }

    /**
     * @dev Block receiving ETH via fallback
     */
    fallback() external payable {
        revert NoNativeTokensAccepted();
    }

    /**
     * @dev Block receiving ERC20 tokens
     * Note: This doesn't fully prevent ERC20 transfers but signals intent
     */
    function onERC20Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        revert NoERC20TokensAccepted();
    }

    /**
     * @dev Block receiving ERC721 tokens (except during minting)
     */
    function onERC721Received(
        address operator,
        address from,
        uint256,
        bytes memory
    ) external view returns (bytes4) {
        // Allow receiving only during minting (from == address(0))
        // or when operator is this contract itself
        if (from == address(0) || operator == address(this)) {
            return this.onERC721Received.selector;
        }
        revert NoERC721TokensAccepted();
    }

    /**
     * @dev Block receiving ERC1155 tokens
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        revert NoERC1155TokensAccepted();
    }

    /**
     * @dev Block receiving ERC1155 batch tokens
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) external pure returns (bytes4) {
        revert NoERC1155TokensAccepted();
    }
}
