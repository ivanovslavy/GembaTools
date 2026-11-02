// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEST-ONLY adversaries for the GembaTools audit suite. Each targets a specific
// value path; all are expected to be DEFEATED (nonReentrant / CEI / fail-closed).

struct VoucherMin { bytes32 orderId; uint256 feeWei; uint64 expiresAt; }

interface IERC20FactoryMin {
    function createToken(string calldata n, string calldata s, uint8 d, uint256 sup, VoucherMin calldata v, bytes calldata sig)
        external payable returns (address);
}

interface IGembaSwapRouterMin {
    function wrapETH() external payable returns (uint256);
}

/// @notice Re-enters a factory's createToken via the excess-refund callback.
contract ReentrantFactoryCaller {
    IERC20FactoryMin public immutable factory;
    uint256 public reenterAttempts;
    bool public reenterReverted;
    bool private armed;

    constructor(address f) { factory = IERC20FactoryMin(f); }

    // Two valid vouchers (different orderIds) for THIS contract as creator — so the only thing that can stop the
    // re-entry is nonReentrant, not the voucher check.
    VoucherMin private v2;
    bytes private sig2;

    function attack(VoucherMin calldata v1, bytes calldata sig1, VoucherMin calldata v2_, bytes calldata sig2_) external payable {
        armed = true;
        v2 = v2_;
        sig2 = sig2_;
        // pay fee + excess so the factory triggers the refund callback into receive()
        factory.createToken{value: msg.value}("Re", "RE", 18, 1000, v1, sig1);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        reenterAttempts++;
        // try to re-enter during the refund
        try factory.createToken{value: msg.value}("Re2", "RE2", 18, 1000, v2, sig2) {}
        catch { reenterReverted = true; }
    }
}

/// @notice Rejects all incoming ETH — used as a fee recipient / refund target to
///         prove the caller fails CLOSED (reverts) instead of losing funds.
contract RejectingReceiver {
    IERC20FactoryMin public factory;
    function setFactory(address f) external { factory = IERC20FactoryMin(f); }
    function createViaFactory(uint256 value, VoucherMin calldata v, bytes calldata sig) external payable returns (address) {
        return factory.createToken{value: value}("X", "X", 18, 1000, v, sig);
    }
    receive() external payable { revert("no ETH"); }
}

/// @notice Re-enters the swap router when it receives the platform fee.
contract ReentrantSwapReceiver {
    IGembaSwapRouterMin public router;
    bool public armed;
    uint256 public reenterAttempts;
    bool public reenterReverted;
    function setRouter(address r) external { router = IGembaSwapRouterMin(r); }
    function arm() external { armed = true; }
    receive() external payable {
        if (!armed) return;
        armed = false;
        reenterAttempts++;
        try router.wrapETH{value: msg.value}() { }
        catch { reenterReverted = true; }
    }
}
