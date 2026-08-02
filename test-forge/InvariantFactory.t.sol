// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {GembaERC20Factory} from "../contracts/GembaERC20Factory.sol";

/// @notice Random createToken calls; the fee recipient must receive exactly the fee
///         per successful create, and the factory must never retain ETH.
contract FactoryHandler is Test {
    GembaERC20Factory public f;
    address public feeRecipient;
    uint256 public fee;
    uint256 public creates;

    constructor(GembaERC20Factory f_, address recv_, uint256 fee_) { f = f_; feeRecipient = recv_; fee = fee_; }

    function create(uint256 payExtra, uint256 seed) public {
        payExtra = bound(payExtra, 0, 5 ether);
        address a = address(uint160(0x1000 + (seed % 20)));
        vm.deal(a, fee + payExtra);
        vm.prank(a);
        try f.createToken{value: fee + payExtra}("T", "T", 18, 1000) { creates++; } catch {}
    }
}

contract InvariantFactory is Test {
    GembaERC20Factory f;
    FactoryHandler handler;
    address owner = address(this);
    address feeRecipient = address(0xFEE);
    uint256 fee = 0.01 ether;

    function setUp() public {
        f = new GembaERC20Factory(owner, feeRecipient, fee);
        handler = new FactoryHandler(f, feeRecipient, fee);
        targetContract(address(handler));
    }

    /// The factory never holds ETH between calls (fee forwarded, excess refunded).
    function invariant_noTrappedEth() public view {
        assertEq(address(f).balance, 0);
    }

    /// feeRecipient balance == number of successful creates × fee.
    function invariant_feeAccounting() public view {
        assertEq(feeRecipient.balance, handler.creates() * fee);
    }
}
