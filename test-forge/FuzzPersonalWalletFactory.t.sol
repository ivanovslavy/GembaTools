// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {GembaPersonalWalletFactory} from "../contracts/GembaPersonalWalletFactory.sol";
import {FeeVoucher} from "../contracts/fees/FeeVoucher.sol";

interface IPersonalWalletMin {
    function owners() external view returns (address[3] memory);
    function isOwner(address) external view returns (bool);
}

/// @notice Fuzzes owner sets through the factory: every successful wallet runs the audited runtime code and is
///         owned by exactly the three requested owners; any invalid set reverts and burns no voucher.
contract FuzzPersonalWalletFactory is Test {
    bytes32 constant AUDITED_RUNTIME_KECCAK = 0x2625763efc81f2991e2dfd3bc65ae530cebfbffbc114e7f96d503416d7a9435a;
    GembaPersonalWalletFactory f;
    uint256 signerPk = 0xB0B;
    uint256 n;

    function setUp() public {
        string memory json = vm.readFile("./artifacts/contracts/PersonalWallet.sol/PersonalWallet.json");
        bytes memory code = vm.parseJsonBytes(json, ".bytecode");
        f = new GembaPersonalWalletFactory(address(this), address(0xFEE), vm.addr(signerPk), code);
    }

    function _voucher(address creator) internal returns (FeeVoucher.Voucher memory v, bytes memory sig) {
        v = FeeVoucher.Voucher(keccak256(abi.encode(++n)), 0, uint64(block.timestamp + 1 hours));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerPk, f.voucherDigest(creator, v));
        sig = abi.encodePacked(r, s, vv);
    }

    function testFuzz_ownersExactlyAsRequested(address a, address b, address c, address cold) public {
        GembaPersonalWalletFactory.WalletParams memory p;
        p.owners = [a, b, c];
        p.requireAllowedRecipient = true;
        p.recipients = new address[](1);
        p.recipients[0] = cold;
        p.recipientLabels = new string[](1);
        p.recipientLabels[0] = "cold";
        (FeeVoucher.Voucher memory v, bytes memory sig) = _voucher(address(this));
        bool valid = a != address(0) && b != address(0) && c != address(0) && a != b && b != c && a != c
            && a != address(f) && b != address(f) && c != address(f);
        try f.createWallet(p, v, sig) returns (address w) {
            assertTrue(valid, "an invalid owner set produced a wallet");
            assertEq(w.codehash, AUDITED_RUNTIME_KECCAK);
            address[3] memory got = IPersonalWalletMin(w).owners();
            assertEq(got[0], a); assertEq(got[1], b); assertEq(got[2], c);
            // the creator (this test) holds a seat only if it asked for one
            assertEq(IPersonalWalletMin(w).isOwner(address(this)), a == address(this) || b == address(this) || c == address(this));
            assertFalse(IPersonalWalletMin(w).isOwner(address(f)));
            assertTrue(f.usedVouchers(v.orderId));
        } catch {
            assertFalse(f.usedVouchers(v.orderId), "a failed create burned the voucher");
        }
    }
}
