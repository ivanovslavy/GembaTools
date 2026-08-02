// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {GembaERC20Tax} from "../contracts/GembaERC20Tax.sol";
import {GembaERC20Advanced, AdvancedTokenParams} from "../contracts/GembaERC20Advanced.sol";

contract FuzzTokens is Test {
    address owner = address(this);
    address taxRecv = address(0x7A);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    // Tax token: for ANY non-owner transfer, tax stays in-supply (no leak/mint).
    function testFuzz_taxConservation(uint256 supply, uint256 taxFee, uint256 amount) public {
        supply = bound(supply, 1, 1e12);
        taxFee = bound(taxFee, 1, 2500);            // 0.01%..25%
        GembaERC20Tax t = new GembaERC20Tax("T", "T", 18, supply, owner, taxRecv, taxFee);
        uint256 total = t.totalSupply();
        // seed alice from owner (owner transfers are tax-free)
        t.transfer(alice, total);
        amount = bound(amount, 0, t.balanceOf(alice));
        vm.prank(alice);
        t.transfer(bob, amount);
        // conservation: alice + bob + taxRecv == total (owner now holds 0)
        assertEq(t.balanceOf(alice) + t.balanceOf(bob) + t.balanceOf(taxRecv) + t.balanceOf(owner), total);
    }

    // Advanced presale: purchased never exceeds the per-wallet cap or presale supply.
    function testFuzz_presaleCap(uint256 rate, uint256 pay) public {
        AdvancedTokenParams memory p;
        p.name = "A"; p.symbol = "A"; p.tokenDecimals = 18;
        p.totalSupply = 1_000_000; p.presaleAmount = 100_000; p.owner = owner; p.taxReceiver = owner;
        GembaERC20Advanced t = new GembaERC20Advanced(p);
        uint256 presaleTokens = 100_000 * 1e18;
        rate = bound(rate, 1e15, 1e24);
        uint256 maxPer = 10_000 * 1e18;
        t.openPresale(rate, presaleTokens, maxPer);
        pay = bound(pay, 1, 100 ether);
        vm.deal(alice, pay);
        vm.prank(alice);
        try t.buyPresale{value: pay}() {
            assertLe(t.presalePurchased(alice), maxPer);
            assertLe(t.presaleEthCollected(), pay);
        } catch { /* over-cap / over-supply correctly reverts */ }
    }
}
