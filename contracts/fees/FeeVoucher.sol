// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title FeeVoucher
 * @notice Every GembaTools factory charges its creation fee through a one-time voucher signed by the
 *         GembaTools backend, instead of a fixed on-chain amount.
 *
 * @dev WHY. The old factories carried `creationFee` in wei, one number for every chain — 0.02 meant
 *      0.02 ETH on Ethereum and 0.02 BNB on BNB Chain. The price now lives off-chain, in EUR, per
 *      contract type, and the backend turns it into one of two things:
 *
 *        - GembaPay mode (GEMBAPAY_FEES=true): the creator paid by card / PayPal / GMB through
 *          GembaPay; the backend signs a voucher with `feeWei = 0` only after it has verified the
 *          GembaPay order as paid (signed webhook + order lookup).
 *        - On-chain mode (GEMBAPAY_FEES=false): the backend converts the price into the chain's
 *          native coin at GembaPay's rate and signs a voucher with that `feeWei`; this contract
 *          then requires `msg.value >= feeWei` and forwards exactly `feeWei` to `feeRecipient`.
 *
 *      WHAT A VOUCHER IS BOUND TO — so it can be used exactly once, for exactly one thing:
 *        - the creator          (`msg.sender` is hashed in; a stolen voucher is useless to anyone else)
 *        - the contract type    (`CONTRACT_TYPE` of this factory)
 *        - the chain + factory  (EIP-712 domain: chainId + verifyingContract)
 *        - the order            (`orderId`, burned in `usedVouchers` on first use)
 *        - a deadline           (`expiresAt`)
 *
 *      FAIL CLOSED. With `voucherSigner == address(0)` nothing can be created: ECDSA.recover never
 *      returns the zero address, so every voucher is rejected. A malformed or high-s signature
 *      reverts inside OpenZeppelin's ECDSA.
 */
abstract contract FeeVoucher is EIP712 {
    /// @notice Contract-type ids shared with the backend (backend/src/pricing.cjs) and the app.
    uint8 internal constant TYPE_ERC20 = 1;
    uint8 internal constant TYPE_ERC20_TAX = 2;
    uint8 internal constant TYPE_ERC20_ADVANCED = 3;
    uint8 internal constant TYPE_ERC721 = 4;
    uint8 internal constant TYPE_ERC721A = 5;
    uint8 internal constant TYPE_ERC1155 = 6;
    uint8 internal constant TYPE_PERSONAL_WALLET = 7;

    struct Voucher {
        bytes32 orderId;
        uint256 feeWei;
        uint64 expiresAt;
    }

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "CreateVoucher(address creator,uint8 contractType,bytes32 orderId,uint256 feeWei,uint64 expiresAt)"
    );

    /// @notice The contract type this factory creates. Part of every voucher it accepts.
    uint8 public immutable CONTRACT_TYPE;

    /// @notice The backend key whose signature authorises a creation. Zero = nothing can be created.
    address public voucherSigner;

    /// @notice orderId => already redeemed. One order, one contract.
    mapping(bytes32 => bool) public usedVouchers;

    event VoucherSignerChanged(address indexed oldSigner, address indexed newSigner);
    event VoucherRedeemed(bytes32 indexed orderId, address indexed creator, uint8 contractType, uint256 feeWei);

    error VoucherAlreadyUsed(bytes32 orderId);
    error VoucherExpired(uint64 expiresAt);
    error BadVoucherSignature();
    error InsufficientFee(uint256 required, uint256 sent);
    error FeeTransferFailed();
    error RefundFailed();

    constructor(uint8 contractType_, address voucherSigner_) EIP712("GembaTools", "1") {
        CONTRACT_TYPE = contractType_;
        voucherSigner = voucherSigner_;
        emit VoucherSignerChanged(address(0), voucherSigner_);
    }

    /// @notice EIP-712 digest the backend signs. Exposed so off-chain code can be checked against it.
    function voucherDigest(address creator, Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, creator, CONTRACT_TYPE, v.orderId, v.feeWei, v.expiresAt))
        );
    }

    /**
     * @dev Checks the voucher for `msg.sender` and burns it. Call FIRST in a create function
     *      (checks-effects-interactions); pay out with `_settleFee` LAST.
     */
    function _redeemVoucher(Voucher calldata v, bytes calldata signature) internal {
        if (usedVouchers[v.orderId]) revert VoucherAlreadyUsed(v.orderId);
        if (block.timestamp > v.expiresAt) revert VoucherExpired(v.expiresAt);
        address signer = ECDSA.recover(voucherDigest(msg.sender, v), signature);
        if (signer != voucherSigner) revert BadVoucherSignature();
        if (msg.value < v.feeWei) revert InsufficientFee(v.feeWei, msg.value);
        usedVouchers[v.orderId] = true;
        emit VoucherRedeemed(v.orderId, msg.sender, CONTRACT_TYPE, v.feeWei);
    }

    /// @dev Forwards exactly `feeWei` to `recipient` and refunds anything sent above it.
    function _settleFee(address recipient, uint256 feeWei) internal {
        if (feeWei > 0) {
            (bool sent, ) = payable(recipient).call{value: feeWei}("");
            if (!sent) revert FeeTransferFailed();
        }
        uint256 excess = msg.value - feeWei;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            if (!refunded) revert RefundFailed();
        }
    }

    function _setVoucherSigner(address newSigner) internal {
        emit VoucherSignerChanged(voucherSigner, newSigner);
        voucherSigner = newSigner;
    }
}
