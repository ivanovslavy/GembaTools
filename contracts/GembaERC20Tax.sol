// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GembaERC20Tax
 * @notice ERC20 token with an immutable transfer tax set at deployment.
 *         A percentage of every transfer is redirected to a tax recipient address.
 *         Only the token owner is excluded from tax — this cannot be changed.
 *         Tax rate is locked at deploy — no rug-pull risk from rate changes.
 *         Supports burn() and burnFrom() — burn is tax-free (to == address(0)).
 *
 * @dev Tax calculation uses basis points (100 = 1%) and rounds down,
 *      which slightly favors the sender on very small transfers.
 */
contract GembaERC20Tax is ERC20, ERC20Burnable, Ownable {
    uint8 private immutable _decimals;
    uint256 public immutable taxFee; // basis points, locked at deploy

    address public taxAddress;

    uint256 public constant MAX_TAX = 2500; // 25% max

    event TaxAddressUpdated(address indexed oldAddress, address indexed newAddress);

    /**
     * @param name_       Token name
     * @param symbol_     Token symbol (max 8 chars)
     * @param decimals_   Number of decimals
     * @param supply_     Total supply in whole tokens
     * @param owner_      Address that owns the token (excluded from tax)
     * @param taxAddress_ Address that receives the tax
     * @param taxFee_     Tax in basis points (e.g. 500 = 5%), immutable after deploy
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply_,
        address owner_,
        address taxAddress_,
        uint256 taxFee_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        require(bytes(name_).length > 0, "GembaTax: empty name");
        require(bytes(symbol_).length > 0, "GembaTax: empty symbol");
        require(bytes(symbol_).length <= 8, "GembaTax: symbol too long");
        require(supply_ > 0, "GembaTax: zero supply");
        require(owner_ != address(0), "GembaTax: zero owner");
        require(taxAddress_ != address(0), "GembaTax: zero tax address");
        require(taxFee_ > 0, "GembaTax: zero tax fee");
        require(taxFee_ <= MAX_TAX, "GembaTax: fee exceeds 25%");

        _decimals = decimals_;
        taxAddress = taxAddress_;
        taxFee = taxFee_;

        _mint(owner_, supply_ * (10 ** decimals_));
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        // Skip tax for: minting, burning, or transfers involving the owner
        if (
            from == address(0) ||
            to == address(0) ||
            from == owner() ||
            to == owner()
        ) {
            super._update(from, to, amount);
            return;
        }

        uint256 taxAmount = (amount * taxFee) / 10000;
        uint256 transferAmount = amount - taxAmount;

        super._update(from, taxAddress, taxAmount);
        super._update(from, to, transferAmount);
    }

    // --- Owner functions ---

    /// @notice Update the address that receives tax. Tax rate cannot be changed.
    function setTaxAddress(address newTaxAddress) external onlyOwner {
        require(newTaxAddress != address(0), "GembaTax: zero address");
        emit TaxAddressUpdated(taxAddress, newTaxAddress);
        taxAddress = newTaxAddress;
    }
}
