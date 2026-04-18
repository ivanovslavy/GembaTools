// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GembaERC20
 * @notice Standard ERC20 token deployed via GembaFactory.
 *         The deploying user becomes the owner and receives the full supply.
 *         This is a real contract (not a proxy/clone) — fully autonomous after creation.
 *         Supports burn() and burnFrom() — any holder can burn their own tokens.
 */
contract GembaERC20 is ERC20, ERC20Burnable, Ownable {
    uint8 private immutable _decimals;

     event CreatedViaGembaTools(address indexed token, string name, string symbol);

    /**
     * @param name_     Token name (e.g. "My Token")
     * @param symbol_   Token symbol (e.g. "MTK", max 8 chars)
     * @param decimals_ Number of decimals (default 18)
     * @param supply_   Total supply in whole tokens (minted to owner)
     * @param owner_    Address that will own the token and receive the supply
     */
        
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        require(bytes(name_).length > 0, "GembaERC20: empty name");
        require(bytes(symbol_).length > 0, "GembaERC20: empty symbol");
        require(bytes(symbol_).length <= 8, "GembaERC20: symbol too long");
        require(supply_ > 0, "GembaERC20: zero supply");
        require(owner_ != address(0), "GembaERC20: zero owner");

        _decimals = decimals_;
        _mint(owner_, supply_ * (10 ** decimals_));
        
        emit CreatedViaGembaTools(address(this), name_, symbol_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
