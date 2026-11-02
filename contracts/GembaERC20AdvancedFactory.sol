// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./GembaERC20Advanced.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./fees/FeeVoucher.sol";

/**
 * @title GembaERC20AdvancedFactory
 * @notice Factory for deploying advanced ERC20 tokens with tax, presale, and anti-bot.
 *
 * Created via GembaTools — https://gembatools.io
 */
contract GembaERC20AdvancedFactory is ReentrancyGuard, FeeVoucher {
    address public owner;
    address public feeRecipient;

    address[] public deployedContracts;

    event ContractDeployed(address indexed contractAddress, address indexed tokenOwner, string name, string symbol);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);

    modifier onlyOwner() {
        require(msg.sender == owner, "GembaERC20AdvancedFactory: not owner");
        _;
    }

    constructor(address owner_, address feeRecipient_, address voucherSigner_) FeeVoucher(TYPE_ERC20_ADVANCED, voucherSigner_) {
        require(owner_ != address(0), "GembaERC20AdvancedFactory: zero owner");
        require(feeRecipient_ != address(0), "GembaERC20AdvancedFactory: zero fee recipient");
        owner = owner_;
        feeRecipient = feeRecipient_;
    }

    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        uint256 totalSupply_,
        uint256 presaleAmount_,
        address taxReceiver_,
        uint16 buyTax_,
        uint16 sellTax_,
        uint16 transferTax_,
        bool taxOnBuy_,
        bool taxOnSell_,
        bool taxOnTransfer_,
        Voucher calldata voucher_,
        bytes calldata signature_
    ) external payable nonReentrant returns (address) {
        // ===== CHECKS =====
        _redeemVoucher(voucher_, signature_);
        require(bytes(name_).length > 0, "GembaERC20AdvancedFactory: empty name");
        require(bytes(symbol_).length > 0, "GembaERC20AdvancedFactory: empty symbol");
        require(totalSupply_ > 0, "GembaERC20AdvancedFactory: zero supply");
        require(decimals_ <= 18, "GembaERC20AdvancedFactory: decimals exceeds 18");
        require(buyTax_ <= 500, "GembaERC20AdvancedFactory: buy tax exceeds 5%");
        require(sellTax_ <= 500, "GembaERC20AdvancedFactory: sell tax exceeds 5%");
        require(transferTax_ <= 500, "GembaERC20AdvancedFactory: transfer tax exceeds 5%");
        require(presaleAmount_ <= totalSupply_, "GembaERC20AdvancedFactory: presale exceeds supply");

        // ===== EFFECTS =====
        GembaERC20Advanced token = new GembaERC20Advanced(
            AdvancedTokenParams({
                name: name_,
                symbol: symbol_,
                tokenDecimals: decimals_,
                totalSupply: totalSupply_,
                presaleAmount: presaleAmount_,
                owner: msg.sender,
                taxReceiver: taxReceiver_,
                buyTax: buyTax_,
                sellTax: sellTax_,
                transferTax: transferTax_,
                taxOnBuy: taxOnBuy_,
                taxOnSell: taxOnSell_,
                taxOnTransfer: taxOnTransfer_
            })
        );

        deployedContracts.push(address(token));
        emit ContractDeployed(address(token), msg.sender, name_, symbol_);

        _settleFee(feeRecipient, voucher_.feeWei);

        return address(token);
    }

    // ========== VIEW ==========

    function getDeployedContracts() external view returns (address[] memory) {
        return deployedContracts;
    }

    function getDeployedCount() external view returns (uint256) {
        return deployedContracts.length;
    }

    // ========== OWNER ==========

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GembaERC20AdvancedFactory: zero owner");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "GembaERC20AdvancedFactory: zero recipient");
        emit FeeRecipientChanged(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setVoucherSigner(address newSigner) external onlyOwner {
        _setVoucherSigner(newSigner);
    }
}
