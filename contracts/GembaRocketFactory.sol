// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./fees/FeeVoucher.sol";
import "./GembaRocketToken.sol";
import "./GembaRocketLauncher.sol";

/**
 * @title GembaRocketFactory
 * @notice Creates a Rocket launch token (GembaRocketToken) TOGETHER with its own GembaRocketLauncher, in one call:
 *           1. the launcher, owned by the caller;
 *           2. the token — name, symbol, supply and guardian tiers chosen by the caller — minted 100 % to the launcher
 *              and owned by it;
 *           3. the launcher is bound to the token.
 *         The caller then goes live with launcher.launch{value: liquidityETH}(lpRecipient), which adds the liquidity,
 *         sets the pair, opens trading and renounces ownership atomically. There is no other way to launch.
 *         The V2 factory and wrapped-native coin of this chain are fixed per factory deployment (immutable).
 *         Creation fee: one-time EIP-712 voucher, exactly like every other GembaTools factory.
 */
contract GembaRocketFactory is Ownable, ReentrancyGuard, FeeVoucher {
    address public feeRecipient;
    address public immutable v2Factory;
    address public immutable weth;

    struct RocketInfo {
        address tokenAddress;
        address launcher;
        address creator;
        string name;
        string symbol;
        uint256 supply;
        uint256 tier1Blocks;
        uint256 tier2Blocks;
        uint256 tier3Blocks;
        uint256 createdAt;
    }

    RocketInfo[] public allTokens;
    mapping(address => RocketInfo[]) public tokensByCreator;

    event RocketTokenCreated(
        address indexed tokenAddress,
        address indexed launcher,
        address indexed creator,
        string name,
        string symbol,
        uint256 supply,
        uint256 tier1Blocks,
        uint256 tier2Blocks,
        uint256 tier3Blocks,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    constructor(
        address owner_,
        address feeRecipient_,
        address voucherSigner_,
        address v2Factory_,
        address weth_
    ) Ownable(owner_) FeeVoucher(TYPE_ROCKET, voucherSigner_) {
        require(feeRecipient_ != address(0), "RocketFactory: zero fee recipient");
        require(v2Factory_ != address(0) && weth_ != address(0), "RocketFactory: zero venue");
        feeRecipient = feeRecipient_;
        v2Factory = v2Factory_;
        weth = weth_;
    }

    /**
     * @param name_    Token name (chosen by the creator)
     * @param symbol_  Token symbol, 1–8 characters
     * @param supply_  Total supply in whole tokens (18 decimals)
     * @param tier1_   Guardian tier 1 in blocks (> 0)
     * @param tier2_   Guardian tier 2 in blocks (> tier1)
     * @param tier3_   Guardian tier 3 in blocks (> tier2, <= 300)
     * @return token    The token
     * @return launcher Its launcher — the only way to go live
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint256 supply_,
        uint256 tier1_,
        uint256 tier2_,
        uint256 tier3_,
        Voucher calldata voucher_,
        bytes calldata signature_
    ) external payable nonReentrant returns (address token, address launcher) {
        _redeemVoucher(voucher_, signature_);

        GembaRocketLauncher l = new GembaRocketLauncher(msg.sender);
        GembaRocketToken t = new GembaRocketToken(name_, symbol_, supply_, address(l), tier1_, tier2_, tier3_, v2Factory, weth);
        l.setToken(address(t));
        token = address(t);
        launcher = address(l);

        allTokens.push(RocketInfo({
            tokenAddress: token, launcher: launcher, creator: msg.sender, name: name_, symbol: symbol_,
            supply: supply_, tier1Blocks: tier1_, tier2Blocks: tier2_, tier3Blocks: tier3_, createdAt: block.timestamp
        }));
        tokensByCreator[msg.sender].push(allTokens[allTokens.length - 1]);

        emit RocketTokenCreated(token, launcher, msg.sender, name_, symbol_, supply_, tier1_, tier2_, tier3_, block.timestamp);

        _settleFee(feeRecipient, voucher_.feeWei);
    }

    // --- View functions ---

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokensByCreator(address creator_) external view returns (RocketInfo[] memory) {
        return tokensByCreator[creator_];
    }

    function getTokens(uint256 offset, uint256 limit) external view returns (RocketInfo[] memory) {
        uint256 total = allTokens.length;
        if (offset >= total) return new RocketInfo[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        RocketInfo[] memory result = new RocketInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) result[i - offset] = allTokens[i];
        return result;
    }

    // --- Owner functions ---

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "RocketFactory: zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setVoucherSigner(address newSigner) external onlyOwner {
        _setVoucherSigner(newSigner);
    }

    // No receive() or fallback() — reject direct ETH transfers
}
