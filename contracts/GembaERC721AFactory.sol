// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "./GembatoolsAdvancedNFT.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GembaERC721AFactory
 * @notice Factory for deploying gas-optimized ERC721A NFT collections via GembaTools.
 * @dev Each deployment creates a standalone, fully independent contract owned by the caller.
 *      No proxies, no clones — real bytecode deployment.
 *
 * Security:
 * - ReentrancyGuard on createToken (ETH transfers before deploy)
 * - Input validation on all parameters
 * - CEI pattern (Checks-Effects-Interactions)
 *
 * Created via GembaTools — https://gembatools.io
 */
contract GembaERC721AFactory is ReentrancyGuard {
    address public owner;
    address public feeRecipient;
    uint256 public creationFee;

    address[] public deployedContracts;

    event ContractDeployed(
        address indexed contractAddress,
        address indexed owner,
        string name,
        string symbol,
        uint256 maxSupply
    );
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeChanged(uint256 oldFee, uint256 newFee);

    modifier onlyOwner() {
        require(msg.sender == owner, "GembaERC721AFactory: not owner");
        _;
    }

    constructor(address owner_, address feeRecipient_, uint256 creationFee_) {
        require(owner_ != address(0), "GembaERC721AFactory: zero owner");
        require(feeRecipient_ != address(0), "GembaERC721AFactory: zero fee recipient");

        owner = owner_;
        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    function createToken(
        string calldata name_,
        string calldata symbol_,
        string calldata baseURI_,
        uint256 maxSupply_,
        uint96 royaltyBasisPoints_,
        address royaltyReceiver_
    ) external payable nonReentrant returns (address) {
        // ===== CHECKS =====
        require(msg.value >= creationFee, "GembaERC721AFactory: insufficient fee");
        require(bytes(name_).length > 0, "GembaERC721AFactory: empty name");
        require(bytes(symbol_).length > 0, "GembaERC721AFactory: empty symbol");
        require(bytes(baseURI_).length > 0, "GembaERC721AFactory: empty base URI");
        require(maxSupply_ > 0, "GembaERC721AFactory: zero max supply");
        require(royaltyBasisPoints_ <= 1000, "GembaERC721AFactory: royalty exceeds 10%");

        // Default royalty receiver to caller if not specified
        address royaltyReceiver = royaltyReceiver_ == address(0) ? msg.sender : royaltyReceiver_;

        // ===== EFFECTS =====
        // Deploy contract before ETH transfers (CEI pattern)
        GembatoolsAdvancedNFT token = new GembatoolsAdvancedNFT(
            name_,
            symbol_,
            baseURI_,
            maxSupply_,
            royaltyBasisPoints_,
            royaltyReceiver,
            msg.sender
        );

        deployedContracts.push(address(token));

        emit ContractDeployed(
            address(token),
            msg.sender,
            name_,
            symbol_,
            maxSupply_
        );

        // ===== INTERACTIONS =====
        // Forward fee after state changes
        if (creationFee > 0) {
            (bool sent, ) = feeRecipient.call{value: creationFee}("");
            require(sent, "GembaERC721AFactory: fee transfer failed");
        }

        // Refund excess
        uint256 excess = msg.value - creationFee;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}("");
            require(refunded, "GembaERC721AFactory: refund failed");
        }

        return address(token);
    }

    // ========== VIEW FUNCTIONS ==========

    function getDeployedContracts() external view returns (address[] memory) {
        return deployedContracts;
    }

    function getDeployedCount() external view returns (uint256) {
        return deployedContracts.length;
    }

    // ========== OWNER FUNCTIONS ==========

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GembaERC721AFactory: zero owner");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "GembaERC721AFactory: zero recipient");
        emit FeeRecipientChanged(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        emit CreationFeeChanged(creationFee, newFee);
        creationFee = newFee;
    }
}
