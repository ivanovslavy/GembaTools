// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GembaERC20Tax.sol";

/**
 * @title GembaERC20TaxFactory
 * @notice Standalone factory for deploying ERC20 tokens with transfer tax.
 *         Carries the full GembaERC20Tax bytecode — each createToken() deploys
 *         a real, independent contract owned by the caller.
 *         Tax rate is immutable after deployment (set by creator).
 *         Creation fee is forwarded immediately to feeRecipient.
 *         Does NOT accept direct ETH transfers.
 */
contract GembaERC20TaxFactory is Ownable, ReentrancyGuard {

    address public feeRecipient;
    uint256 public creationFee;

    struct TokenInfo {
        address tokenAddress;
        address creator;
        string name;
        string symbol;
        uint256 supply;
        address taxAddress;
        uint256 taxFee;
        uint256 createdAt;
    }

    TokenInfo[] public allTokens;
    mapping(address => TokenInfo[]) public tokensByCreator;

    event TaxTokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 supply,
        address taxAddress,
        uint256 taxFee,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @param owner_        Factory owner (can update fee settings)
     * @param feeRecipient_ Address that receives creation fees
     * @param creationFee_  Fee in wei (e.g. 0.06 ether)
     */
    constructor(
        address owner_,
        address feeRecipient_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(feeRecipient_ != address(0), "TaxFactory: zero fee recipient");
        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    /**
     * @notice Deploy an ERC20 with immutable transfer tax.
     * @param name_       Token name
     * @param symbol_     Token symbol (max 8 chars)
     * @param decimals_   Decimals (default 18)
     * @param supply_     Total supply in whole tokens
     * @param taxAddress_ Address that receives the transfer tax
     * @param taxFee_     Tax in basis points (e.g. 500 = 5%), max 2500 (25%)
     * @return token      Address of the deployed token
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 supply_,
        address taxAddress_,
        uint256 taxFee_
    ) external payable nonReentrant returns (address token) {
        require(msg.value >= creationFee, "TaxFactory: insufficient fee");
        require(taxAddress_ != address(0), "TaxFactory: zero tax address");
        require(taxFee_ > 0, "TaxFactory: zero tax fee");
        require(taxFee_ <= 2500, "TaxFactory: tax exceeds 25%");

        GembaERC20Tax newToken = new GembaERC20Tax(
            name_,
            symbol_,
            decimals_,
            supply_,
            msg.sender,
            taxAddress_,
            taxFee_
        );

        token = address(newToken);

        allTokens.push(TokenInfo({
            tokenAddress: token,
            creator: msg.sender,
            name: name_,
            symbol: symbol_,
            supply: supply_,
            taxAddress: taxAddress_,
            taxFee: taxFee_,
            createdAt: block.timestamp
        }));
        tokensByCreator[msg.sender].push(allTokens[allTokens.length - 1]);

        emit TaxTokenCreated(
            token, msg.sender, name_, symbol_,
            supply_, taxAddress_, taxFee_, block.timestamp
        );

        // Forward fee to recipient
        (bool sent, ) = payable(feeRecipient).call{value: creationFee}("");
        require(sent, "TaxFactory: fee transfer failed");

        // Refund excess
        uint256 excess = msg.value - creationFee;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            require(refunded, "TaxFactory: refund failed");
        }

        return token;
    }

    // --- View functions ---

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokensByCreator(address creator_) external view returns (TokenInfo[] memory) {
        return tokensByCreator[creator_];
    }

    function getTokens(uint256 offset, uint256 limit) external view returns (TokenInfo[] memory) {
        uint256 total = allTokens.length;
        if (offset >= total) return new TokenInfo[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        TokenInfo[] memory result = new TokenInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allTokens[i];
        }
        return result;
    }

    // --- Owner functions ---

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "TaxFactory: zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        emit CreationFeeUpdated(creationFee, newFee);
        creationFee = newFee;
    }

    // No receive() or fallback() — reject direct ETH transfers
}
