// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FeeOnTransferERC20
 * @notice TEST-ONLY. Skims a fee on every transfer, so a recipient receives LESS
 *         than the sent amount. Used to probe GembaSwapRouter's token paths, which
 *         pull `amountIn`, then approve/swap `amountIn` — a mismatch if the token
 *         delivered less into the router.
 */
contract FeeOnTransferERC20 is ERC20 {
    uint256 public feeBps;
    address public constant SINK = address(0xdEaD);
    constructor(uint256 feeBps_) ERC20("FeeToken", "FEE") { feeBps = feeBps_; }
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, to, value - fee);
            if (fee > 0) super._update(from, SINK, fee);
        } else {
            super._update(from, to, value);
        }
    }
}
