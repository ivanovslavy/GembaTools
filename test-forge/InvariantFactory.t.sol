// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {GembaERC20Factory} from "../contracts/GembaERC20Factory.sol";
import {FeeVoucher} from "../contracts/fees/FeeVoucher.sol";

/// @notice Random createToken calls with backend vouchers — valid, replayed, stolen (another creator),
///         under-paid. The fee recipient must receive exactly the voucher fee per successful create,
///         the factory must never retain ETH, and no orderId may ever create twice.
contract FactoryHandler is Test {
    GembaERC20Factory public f;
    address public feeRecipient;
    uint256 internal signerPk;

    uint256 public creates;
    uint256 public feesExpected;
    uint256 public replaysThatSucceeded;
    uint256 public stolenThatSucceeded;
    uint256 public underpaidThatSucceeded;
    bytes32[] internal used;
    uint256 internal nonce;

    constructor(GembaERC20Factory f_, address recv_, uint256 pk_) { f = f_; feeRecipient = recv_; signerPk = pk_; }

    function _sign(address creator, FeeVoucher.Voucher memory v) internal view returns (bytes memory) {
        bytes32 digest = f.voucherDigest(creator, v);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, vv);
    }

    function _creator(uint256 seed) internal pure returns (address) { return address(uint160(0x1000 + (seed % 20))); }

    function _fresh() internal returns (bytes32) { return keccak256(abi.encode("order", ++nonce)); }

    function create(uint256 fee, uint256 payExtra, uint256 seed) public {
        fee = bound(fee, 0, 1 ether);
        payExtra = bound(payExtra, 0, 5 ether);
        address a = _creator(seed);
        FeeVoucher.Voucher memory v = FeeVoucher.Voucher(_fresh(), fee, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(a, v);
        vm.deal(a, fee + payExtra);
        vm.prank(a);
        try f.createToken{value: fee + payExtra}("T", "T", 18, 1000, v, sig) {
            creates++; feesExpected += fee; used.push(v.orderId);
        } catch {}
    }

    /// Re-signs an orderId that already created something. Must never succeed.
    function replay(uint256 idx, uint256 seed) public {
        if (used.length == 0) return;
        address a = _creator(seed);
        FeeVoucher.Voucher memory v = FeeVoucher.Voucher(used[idx % used.length], 0, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(a, v);
        vm.prank(a);
        try f.createToken("T", "T", 18, 1000, v, sig) { replaysThatSucceeded++; } catch {}
    }

    /// Uses a valid voucher signed for someone else. Must never succeed.
    function steal(uint256 seed) public {
        address victim = _creator(seed);
        address thief = _creator(seed + 1);
        FeeVoucher.Voucher memory v = FeeVoucher.Voucher(_fresh(), 0, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(victim, v);
        vm.prank(thief);
        try f.createToken("T", "T", 18, 1000, v, sig) { stolenThatSucceeded++; } catch {}
    }

    /// Pays less than the signed fee. Must never succeed.
    function underpay(uint256 fee, uint256 short, uint256 seed) public {
        fee = bound(fee, 1, 1 ether);
        short = bound(short, 1, fee);
        address a = _creator(seed);
        FeeVoucher.Voucher memory v = FeeVoucher.Voucher(_fresh(), fee, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(a, v);
        vm.deal(a, fee);
        vm.prank(a);
        try f.createToken{value: fee - short}("T", "T", 18, 1000, v, sig) { underpaidThatSucceeded++; } catch {}
    }
}

contract InvariantFactory is Test {
    GembaERC20Factory f;
    FactoryHandler handler;
    address owner = address(this);
    address feeRecipient = address(0xFEE);
    uint256 signerPk = 0xA11CE;

    function setUp() public {
        f = new GembaERC20Factory(owner, feeRecipient, vm.addr(signerPk));
        handler = new FactoryHandler(f, feeRecipient, signerPk);
        targetContract(address(handler));
    }

    /// The factory never holds ETH between calls (fee forwarded, excess refunded).
    function invariant_noTrappedEth() public view {
        assertEq(address(f).balance, 0);
    }

    /// feeRecipient balance == Σ voucher fees of the successful creates.
    function invariant_feeAccounting() public view {
        assertEq(feeRecipient.balance, handler.feesExpected());
    }

    /// One orderId = one contract; a replayed, stolen or under-paid voucher never creates.
    function invariant_vouchersCannotBeAbused() public view {
        assertEq(handler.replaysThatSucceeded(), 0);
        assertEq(handler.stolenThatSucceeded(), 0);
        assertEq(handler.underpaidThatSucceeded(), 0);
        assertEq(f.totalTokens(), handler.creates());
    }

    /// The campaign must actually reach the success path, or the invariants above hold vacuously.
    function afterInvariant() public view {
        assertGt(handler.creates(), 0, "no create ever succeeded - campaign proved nothing");
    }
}
