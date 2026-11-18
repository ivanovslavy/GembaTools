// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title GembaRocketLauncher
 * @notice The ONLY way a GembaRocketToken goes live. Deployed by GembaRocketFactory together with the token: the token
 *         is minted to this launcher and owned by it, so nobody — not the creator, not the factory — can call setLp or
 *         executeTrading out of order (the one-way setLp trap of the original Rocket cannot happen).
 *
 *         launch() does, in ONE transaction:
 *           1. puts 100 % of the supply and all the ETH sent into the V2 pair (created here if it does not exist),
 *           2. mints the LP tokens to `lpRecipient`,
 *           3. setLp(pair) — validated by the token against its V2 factory,
 *           4. executeTrading() — the guardian window starts,
 *           5. renounces the token's ownership (both one-shot functions are spent; the owner has no power left).
 *         EVM atomicity: there is no block in which the pool is live and unguarded.
 *
 * @dev Liquidity goes in through pair.mint, not the router's addLiquidityETH: someone could create the empty pair and
 *      sync a dust of WETH into it, after which the router's quote divides by a zero token reserve and every launch
 *      would revert. mint() works from balances, so a donation only adds to the creator's LP.
 */
interface IRocketTokenL {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function setLp(address lpPair) external;
    function executeTrading() external;
    function renounceOwnership() external;
    function owner() external view returns (address);
    function factory() external view returns (address);
    function weth() external view returns (address);
}

interface IV2FactoryL {
    function getPair(address a, address b) external view returns (address);
    function createPair(address a, address b) external returns (address);
}

interface IV2PairL {
    function mint(address to) external returns (uint256 liquidity);
}

interface IWETHL {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
}

contract GembaRocketLauncher {
    /// @notice The creator — the only address that can launch.
    address public immutable owner;
    /// @notice The factory that deployed this launcher and its token (binds the token in `setToken`).
    address public immutable deployer;
    /// @notice The token this launcher launches (set once by the factory, right after the token is deployed).
    address public token;
    bool public launched;

    event Launched(address indexed token, address indexed pair, uint256 tokenAmount, uint256 ethAmount, uint256 liquidity, address lpRecipient);

    error NotOwner();
    error NotDeployer();
    error TokenAlreadySet();
    error AlreadyLaunched();
    error NoEth();
    error ZeroAddress();
    error NotFullSupply();
    error NotTokenOwner();
    error TransferFailed();

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        deployer = msg.sender;
    }

    function setToken(address token_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (token != address(0)) revert TokenAlreadySet();
        if (token_ == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice Launch: 100 % of the supply + msg.value into the V2 pair, setLp, executeTrading, renounce — atomically.
    function launch(address lpRecipient) external payable returns (address pair, uint256 liquidity) {
        if (msg.sender != owner) revert NotOwner();
        if (launched) revert AlreadyLaunched();
        if (msg.value == 0) revert NoEth();
        if (lpRecipient == address(0)) revert ZeroAddress();
        IRocketTokenL t = IRocketTokenL(token);
        if (address(t) == address(0)) revert ZeroAddress();
        if (t.owner() != address(this)) revert NotTokenOwner();
        uint256 supply = t.balanceOf(address(this));
        if (supply == 0 || supply != t.totalSupply()) revert NotFullSupply(); // fair launch: everything into the pool
        launched = true;

        address f = t.factory();
        address w = t.weth();
        pair = IV2FactoryL(f).getPair(address(t), w);
        if (pair == address(0)) pair = IV2FactoryL(f).createPair(address(t), w);

        if (!t.transfer(pair, supply)) revert TransferFailed();             // lpPair is still unset → a plain transfer
        IWETHL(w).deposit{value: msg.value}();
        if (!IWETHL(w).transfer(pair, msg.value)) revert TransferFailed();
        liquidity = IV2PairL(pair).mint(lpRecipient);

        t.setLp(pair);
        t.executeTrading();
        t.renounceOwnership();

        emit Launched(address(t), pair, supply, msg.value, liquidity, lpRecipient);
    }
}
