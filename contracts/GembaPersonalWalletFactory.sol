// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./fees/FeeVoucher.sol";

/**
 * @title GembaPersonalWalletFactory
 * @notice Deploys PersonalWallet — the 2-of-3 multisig savings wallet (github.com/ivanovslavy/personal-wallet,
 *         copied byte-for-byte into contracts/PersonalWallet.sol) — through GembaTools.
 *
 * @dev WHY THE CODE IS STORED AND NOT COMPILED IN.
 *      PersonalWallet's creation code is 25 220 bytes. Compiling it into this factory with `new` would make the
 *      factory's own runtime larger than EIP-170 allows (24 576 B). So the AUDITED creation code is passed in once,
 *      at deployment, and kept in two data contracts (runtime = 0x00 ++ chunk, the leading STOP makes them
 *      uncallable). `walletCodeHash` is keccak256 of the whole creation code: anyone can compare it with the
 *      artifact of the audited build — the factory test does exactly that.
 *
 *      A wallet made here runs the same initcode a direct deployment runs, so its runtime bytecode is identical
 *      (proven in test/11-personal-wallet-factory.test.js). PersonalWallet never reads msg.sender in its
 *      constructor, so being created by a factory changes nothing about who controls it: only the three owners.
 *
 *      Two rules are enforced here on top of the wallet: a strict-recipient wallet must be born with at least one
 *      allowlisted recipient (the cold escape hatch — the project's own deploy.js refuses the same thing), and the
 *      factory itself can never be one of the three owners (its seat would be dead, 2-of-3 would become 2-of-2).
 */
contract GembaPersonalWalletFactory is Ownable, ReentrancyGuard, FeeVoucher {
    address public feeRecipient;

    /// @notice keccak256 of the PersonalWallet creation code this factory deploys.
    bytes32 public immutable walletCodeHash;
    /// @notice Total length of the stored creation code.
    uint256 public immutable walletCodeLength;

    address private immutable _chunk0;
    address private immutable _chunk1;
    uint256 private immutable _len0;

    struct WalletParams {
        address[3] owners;
        bool requireAllowedRecipient;
        bool requireAllowedToken;
        address[] recipients;
        string[] recipientLabels;
        address[] tokens;
        string[] tokenLabels;
    }

    address[] public allWallets;
    mapping(address => address[]) private _walletsByCreator;
    mapping(address => address[]) private _walletsByOwner;

    event WalletCreated(
        address indexed wallet,
        address indexed creator,
        address[3] owners,
        bool requireAllowedRecipient,
        bool requireAllowedToken,
        uint256 timestamp
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    error EmptyCode();
    error CodeTooLarge(uint256 length);
    error StoreFailed();
    error StrictModeNeedsRecipient();
    error FactoryCannotOwn();

    /**
     * @param owner_            Factory owner (fee recipient + voucher signer)
     * @param feeRecipient_     Receives native creation fees (on-chain fee mode)
     * @param voucherSigner_    Backend key that signs creation vouchers
     * @param walletCreationCode_ PersonalWallet creation code (artifact `bytecode`, no constructor args)
     */
    constructor(
        address owner_,
        address feeRecipient_,
        address voucherSigner_,
        bytes memory walletCreationCode_
    ) Ownable(owner_) FeeVoucher(TYPE_PERSONAL_WALLET, voucherSigner_) {
        require(feeRecipient_ != address(0), "PersonalWalletFactory: zero fee recipient");
        uint256 len = walletCreationCode_.length;
        if (len == 0) revert EmptyCode();
        if (len > 2 * 24_575) revert CodeTooLarge(len);
        feeRecipient = feeRecipient_;

        uint256 len0 = len / 2;
        bytes memory a = new bytes(len0);
        bytes memory b = new bytes(len - len0);
        assembly ("memory-safe") {
            let src := add(walletCreationCode_, 0x20)
            mcopy(add(a, 0x20), src, len0)
            mcopy(add(b, 0x20), add(src, len0), sub(len, len0))
        }

        _chunk0 = _store(a);
        _chunk1 = _store(b);
        _len0 = len0;
        walletCodeLength = len;
        walletCodeHash = keccak256(walletCreationCode_);
    }

    /**
     * @notice Deploy a PersonalWallet with the given owners and policy.
     * @dev The creator need not be one of the owners (a wallet can be set up for someone else);
     *      the owners alone control it from the first block.
     */
    function createWallet(WalletParams calldata p, Voucher calldata voucher_, bytes calldata signature_)
        external
        payable
        nonReentrant
        returns (address wallet)
    {
        _redeemVoucher(voucher_, signature_);
        if (p.requireAllowedRecipient && p.recipients.length == 0) revert StrictModeNeedsRecipient();
        // A seat held by this factory would be dead forever (it has no way to confirm anything):
        // 2-of-3 would silently become 2-of-2. Found by the fuzzer, refused here.
        for (uint256 i; i < 3; ++i) if (p.owners[i] == address(this)) revert FactoryCannotOwn();

        bytes memory initCode = abi.encodePacked(
            walletCreationCode(),
            abi.encode(
                p.owners,
                p.requireAllowedRecipient,
                p.requireAllowedToken,
                p.recipients,
                p.recipientLabels,
                p.tokens,
                p.tokenLabels
            )
        );
        assembly ("memory-safe") {
            wallet := create(0, add(initCode, 0x20), mload(initCode))
            if iszero(wallet) {
                // Bubble the wallet constructor's own error (DuplicateOwner, ZeroAddress, LengthMismatch, ...).
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
        }

        allWallets.push(wallet);
        _walletsByCreator[msg.sender].push(wallet);
        for (uint256 i; i < 3; ++i) _walletsByOwner[p.owners[i]].push(wallet);

        emit WalletCreated(wallet, msg.sender, p.owners, p.requireAllowedRecipient, p.requireAllowedToken, block.timestamp);

        _settleFee(feeRecipient, voucher_.feeWei);
    }

    // --- View functions ---

    /// @notice The stored PersonalWallet creation code (without constructor arguments).
    function walletCreationCode() public view returns (bytes memory code) {
        uint256 len = walletCodeLength;
        uint256 len0 = _len0;
        address c0 = _chunk0;
        address c1 = _chunk1;
        code = new bytes(len);
        assembly ("memory-safe") {
            let dst := add(code, 0x20)
            extcodecopy(c0, dst, 1, len0)
            extcodecopy(c1, add(dst, len0), 1, sub(len, len0))
        }
    }

    function totalWallets() external view returns (uint256) {
        return allWallets.length;
    }

    function getWalletsByCreator(address creator_) external view returns (address[] memory) {
        return _walletsByCreator[creator_];
    }

    /// @notice Wallets whose INITIAL owner set contained `owner_`. Owners can rotate later — always confirm with
    ///         the wallet's own `isOwner()` before trusting this list.
    function getWalletsByOwner(address owner_) external view returns (address[] memory) {
        return _walletsByOwner[owner_];
    }

    // --- Owner functions ---

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "PersonalWalletFactory: zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setVoucherSigner(address newSigner) external onlyOwner {
        _setVoucherSigner(newSigner);
    }

    // --- Internal ---

    /// @dev Deploys a data contract whose runtime code is 0x00 ++ data.
    function _store(bytes memory data) private returns (address ptr) {
        bytes memory runtime = abi.encodePacked(hex"00", data);
        // PUSH2 len, DUP1, PUSH1 0x0a, RETURNDATASIZE, CODECOPY, RETURNDATASIZE, RETURN  (10-byte prefix)
        bytes memory init = abi.encodePacked(hex"61", uint16(runtime.length), hex"80600a3d393df3", runtime);
        assembly ("memory-safe") {
            ptr := create(0, add(init, 0x20), mload(init))
        }
        if (ptr == address(0)) revert StoreFailed();
    }
}
