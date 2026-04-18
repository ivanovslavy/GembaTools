// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GembaERC20.sol";

/**
 * @title GembaERC20Factory
 * @notice Standalone factory for deploying standard ERC20 tokens.
 *         Carries the full GembaERC20 bytecode — each createToken() deploys
 *         a real, independent contract owned by the caller.
 *         Creation fee is forwarded immediately to feeRecipient.
 *         Does NOT accept direct ETH transfers.
 */
contract GembaERC20Factory is Ownable, ReentrancyGuard {

    address public feeRecipient;
    uint256 public creationFee;

    struct TokenInfo {
        address tokenAddress;
        address creator;
        string name;
        string symbol;
        uint256 supply;
        uint256 createdAt;
    }

    TokenInfo[] public allTokens;
    mapping(address => TokenInfo[]) public tokensByCreator;

    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 supply,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @param owner_        Factory owner (can update fee settings)
     * @param feeRecipient_ Address that receives creation fees
     * @param creationFee_  Fee in wei (e.g. 0.03 ether)
     */
    constructor(
        address owner_,
        address feeRecipient_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(feeRecipient_ != address(0), "ERC20Factory: zero fee recipient");
        feeRecipient = feeRecipient_;
        creationFee = creationFee_;
    }

    /**
     * @notice Deploy a standard ERC20 token. Fee is forwarded to feeRecipient.
     * @param name_     Token name
     * @param symbol_   Token symbol (max 8 chars)
     * @param decimals_ Decimals (default 18)
     * @param supply_   Total supply in whole tokens
     * @return token    Address of the deployed token
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 supply_
    ) external payable nonReentrant returns (address token) {
        require(msg.value >= creationFee, "ERC20Factory: insufficient fee");

        GembaERC20 newToken = new GembaERC20(
            name_,
            symbol_,
            decimals_,
            supply_,
            msg.sender
        );

        token = address(newToken);

        allTokens.push(TokenInfo({
            tokenAddress: token,
            creator: msg.sender,
            name: name_,
            symbol: symbol_,
            supply: supply_,
            createdAt: block.timestamp
        }));
        tokensByCreator[msg.sender].push(allTokens[allTokens.length - 1]);

        emit TokenCreated(token, msg.sender, name_, symbol_, supply_, block.timestamp);

        // Forward fee to recipient
        (bool sent, ) = payable(feeRecipient).call{value: creationFee}("");
        require(sent, "ERC20Factory: fee transfer failed");

        // Refund excess
        uint256 excess = msg.value - creationFee;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            require(refunded, "ERC20Factory: refund failed");
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
        require(newRecipient != address(0), "ERC20Factory: zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        emit CreationFeeUpdated(creationFee, newFee);
        creationFee = newFee;
    }

    // No receive() or fallback() — reject direct ETH transfers
}
