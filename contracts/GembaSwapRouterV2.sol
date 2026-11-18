// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IUniswapV2FactoryR {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2PairR {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IWETH9R {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/**
 * @title GembaSwapRouterV2
 * @notice The Uniswap V2 sibling of GembaSwapRouter, for FEE-ON-TRANSFER tokens (GembaTools Tax, Advanced and Rocket
 *         tokens). Same settings as the V3 router: platform fee in basis points (default 30 = 0.3 %), hard cap 1 %,
 *         fee taken in the native coin and sent to `feeRecipient`, owner can change fee/recipient only within the cap.
 *
 * @dev WHY ITS OWN SWAP LOOP. A V3 pool reverts ("IIA") when a taxed transfer delivers less than the amount it asked
 *      for, so taxed tokens trade on V2. Routing through Uniswap's V2 router would move the token TWICE (user → this
 *      router → pair) and tax it twice. Here the token goes straight from the user to the pair (one transfer, taxed
 *      once — exactly as with Uniswap's own "...SupportingFeeOnTransferTokens"), the input is measured from the pair's
 *      real balance, and the output is measured from the recipient's real balance before checking `amountOutMin`.
 *      Pair math is Uniswap V2's (0.3 % LP fee, 997/1000).
 */
contract GembaSwapRouterV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUniswapV2FactoryR public immutable factory;
    IWETH9R public immutable WETH9;

    address public feeRecipient;
    uint256 public platformFee; // basis points, 30 = 0.3 %
    uint256 public constant MAX_FEE = 100; // 1 % hard cap

    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeTaken
    );
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    constructor(
        address owner_,
        address factory_,
        address weth9_,
        address feeRecipient_,
        uint256 platformFee_
    ) Ownable(owner_) {
        require(factory_ != address(0), "zero factory");
        require(weth9_ != address(0), "zero weth");
        require(feeRecipient_ != address(0), "zero recipient");
        require(platformFee_ <= MAX_FEE, "fee too high");
        factory = IUniswapV2FactoryR(factory_);
        WETH9 = IWETH9R(weth9_);
        feeRecipient = feeRecipient_;
        platformFee = platformFee_;
    }

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "transaction expired");
        _;
    }

    // ===================== Quotes (views) =====================

    /// @notice Uniswap V2 output for `amountIn` actually ARRIVING in the pair.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0, "zero input");
        require(reserveIn > 0 && reserveOut > 0, "no liquidity");
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @notice Reserves of the (tokenA, tokenB) pair, in that order. (0, 0) when there is no pair.
    function getReserves(address tokenA, address tokenB) public view returns (uint256 reserveA, uint256 reserveB) {
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);
        (uint112 r0, uint112 r1, ) = IUniswapV2PairR(pair).getReserves();
        (reserveA, reserveB) = tokenA == IUniswapV2PairR(pair).token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    // ===================== Swaps =====================

    /// @notice ETH → token. Fee from the ETH input; the token goes from the pair straight to the caller.
    function swapETHForTokens(address tokenOut, uint256 amountOutMin, uint256 deadline)
        external payable nonReentrant checkDeadline(deadline) returns (uint256 amountOut)
    {
        require(msg.value > 0, "zero value");
        uint256 fee = (msg.value * platformFee) / 10000;
        uint256 swapAmount = msg.value - fee;
        _payFee(fee);

        address pair = _pair(address(WETH9), tokenOut);
        WETH9.deposit{value: swapAmount}();
        require(WETH9.transfer(pair, swapAmount), "weth transfer failed");

        uint256 before = IERC20(tokenOut).balanceOf(msg.sender);
        _swap(pair, address(WETH9), msg.sender);
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - before;
        require(amountOut >= amountOutMin, "insufficient output");

        emit SwapExecuted(msg.sender, address(0), tokenOut, msg.value, amountOut, fee);
    }

    /// @notice token → ETH. The token goes from the caller straight to the pair (taxed once); fee from the ETH output.
    function swapTokensForETH(address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline)
        external nonReentrant checkDeadline(deadline) returns (uint256 amountOut)
    {
        require(amountIn > 0, "zero amount");
        address pair = _pair(tokenIn, address(WETH9));
        IERC20(tokenIn).safeTransferFrom(msg.sender, pair, amountIn);

        uint256 wethBefore = WETH9.balanceOf(address(this));
        _swap(pair, tokenIn, address(this));
        uint256 wethOut = WETH9.balanceOf(address(this)) - wethBefore;
        WETH9.withdraw(wethOut);

        uint256 fee = (wethOut * platformFee) / 10000;
        amountOut = wethOut - fee;
        require(amountOut >= amountOutMin, "insufficient output");
        _payFee(fee);
        (bool sent, ) = msg.sender.call{value: amountOut}("");
        require(sent, "eth transfer failed");

        emit SwapExecuted(msg.sender, tokenIn, address(0), amountIn, amountOut, fee);
    }

    /// @notice token → WETH → token. Fee taken in the native coin between the two hops (as the V3 router does).
    function swapTokensForTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 deadline)
        external nonReentrant checkDeadline(deadline) returns (uint256 amountOut)
    {
        require(amountIn > 0, "zero amount");
        require(tokenIn != tokenOut, "same token");
        address pairIn = _pair(tokenIn, address(WETH9));
        address pairOut = _pair(address(WETH9), tokenOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, pairIn, amountIn);

        uint256 wethBefore = WETH9.balanceOf(address(this));
        _swap(pairIn, tokenIn, address(this));
        uint256 wethOut = WETH9.balanceOf(address(this)) - wethBefore;

        uint256 fee = (wethOut * platformFee) / 10000;
        if (fee > 0) {
            WETH9.withdraw(fee);
            _payFee(fee);
        }
        require(WETH9.transfer(pairOut, wethOut - fee), "weth transfer failed");

        uint256 before = IERC20(tokenOut).balanceOf(msg.sender);
        _swap(pairOut, address(WETH9), msg.sender);
        amountOut = IERC20(tokenOut).balanceOf(msg.sender) - before;
        require(amountOut >= amountOutMin, "insufficient output");

        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ===================== Owner functions =====================

    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "fee too high");
        emit FeeUpdated(platformFee, newFee);
        platformFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ===================== Internals =====================

    function _pair(address a, address b) internal view returns (address pair) {
        pair = factory.getPair(a, b);
        require(pair != address(0), "no pair");
    }

    /// @dev Uniswap V2's fee-on-transfer-safe single hop: the input is what the pair REALLY received.
    function _swap(address pair, address input, address to) internal {
        (uint112 r0, uint112 r1, ) = IUniswapV2PairR(pair).getReserves();
        bool inputIs0 = input == IUniswapV2PairR(pair).token0();
        (uint256 reserveIn, uint256 reserveOut) = inputIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 amountInput = IERC20(input).balanceOf(pair) - reserveIn;
        uint256 amountOutput = getAmountOut(amountInput, reserveIn, reserveOut);
        (uint256 a0, uint256 a1) = inputIs0 ? (uint256(0), amountOutput) : (amountOutput, uint256(0));
        IUniswapV2PairR(pair).swap(a0, a1, to, new bytes(0));
    }

    function _payFee(uint256 fee) internal {
        if (fee == 0) return;
        (bool sent, ) = feeRecipient.call{value: fee}("");
        require(sent, "fee transfer failed");
    }

    /// @dev Only WETH unwraps send ETH here.
    receive() external payable {
        require(msg.sender == address(WETH9), "only weth");
    }
}
